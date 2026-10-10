import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { logger, redactSecret } from '../../../logger/index.js';
import { CircuitBreaker } from '../circuit_breaker.js';
import { BaseBankAdapter } from './base.adapter.js';
import { getSetting } from '../../settings.service.js';
import { resolveCircuitBreakerConfig } from '../breaker_config.js';
import {
  CBE_PERMITTED_HOSTNAMES,
  DEFAULT_BANK_NETWORK_TIMEOUT_MS,
  parseEthiopianBankTimestamp,
} from '../constants.js';
import {
  SupportedBank,
  ExtractedReceiptReference,
  BankTransactionPayload,
  BankVerificationOptions,
  PortalGeoblockedError,
  ProxyConfigError,
  UnconfirmedTransactionError,
  InvalidReceiptReferenceError,
} from '../types.js';

// ============================================================================
// Statically Instantiated Regular Expressions
// ============================================================================

/**
 * The only reference shape the CBE rail can verify.
 *
 * Case-sensitive by construction (no `i` flag): the token body is a mixed-case
 * credential, so folding case here would invent references that do not exist.
 */
const CBE_TOKEN_SEGMENT_PATTERN = /^v2-[A-Za-z0-9]{16,24}$/;

/**
 * CBE's answer to an unknown or tampered token, in its own words.
 *
 * The endpoint answers **HTTP 500** (not 404, not 400) with an RFC 7807 body
 * whose `detail` is "Security Alert: Invalid or tampered legacy token!". Both
 * the phrase and the status matter: without this match, a 500 is
 * indistinguishable from a genuine outage.
 */
const CBE_INVALID_TOKEN_DETAIL_PATTERN = /invalid|tampered/i;
const CBE_NOT_FOUND_DETAIL_PATTERN = /not found|cannot be found/i;

const NON_AMOUNT_CHARS_PATTERN = /[^0-9.]/g;

/**
 * `HttpsProxyAgent` is generic over the parsed proxy URI. Inferred from the
 * constructor so the internal `Uri` type never has to be named or imported.
 */
type HttpsProxyAgentInstance = InstanceType<typeof HttpsProxyAgent>;

// ============================================================================
// Upstream API Contract (verified against the live endpoint)
// ============================================================================

/**
 * Host serving the public transaction-detail JSON API.
 *
 * Distinct from the receipt link host (`mbreciept.cbe.com.et`, which serves a
 * Nuxt JavaScript shell). The shell is deliberately NOT the fetch target: it
 * returns HTML with no receipt fields in it, so the bot would have to scrape a
 * rendered page. The API returns the same receipt as JSON.
 */
const CBE_API_HOST = 'mb.cbe.com.et';

const CBE_API_PATH_PREFIX = '/api/v1/transactions/public/transaction-detail';

/**
 * Public app identity the receipt SPA sends with every call. Not a secret and
 * not per-customer: it is the same for every visitor of the public receipt page,
 * which is why the endpoint needs no authentication. Omitting either header
 * makes the API refuse the request.
 */
const CBE_APP_ID_HEADER = 'X-App-ID';
const CBE_APP_ID = 'd1292e42-7400-49de-a2d3-9731caa4c819';
const CBE_APP_VERSION_HEADER = 'X-App-Version';
const CBE_APP_VERSION = '0a01980b-9859-1369-8198-59f403820000';

/** The bank's own verdict that the money actually moved. */
const CBE_STATUS_COMPLETED = 'COMPLETED';

// ============================================================================
// Upstream Response Shape
// ============================================================================

/**
 * The subset of the upstream transaction-detail document this adapter reads.
 *
 * Every value arrives as a string. Only the three boolean flags are real
 * booleans, which is why they are typed separately rather than as `string`.
 */
interface CbeTransactionDetail {
  /** Bank-side transaction id. NOT the request token — reference-binding by string equality is impossible. */
  id?: string;
  /** `COMPLETED` when the transfer settled. */
  status?: string;
  /** SETTLED amount credited to the receiver, 2dp. The only trustworthy amount. */
  amountCredited?: string;
  /** Amount taken from the sender. Includes fees; NOT what the merchant received. */
  amountDebited?: string;
  /** Total bank charges. */
  totalChargeAmount?: string;
  /** Total tax withheld. */
  totalTaxAmount?: string;
  /** Service charge component. */
  serviceChargeValue?: string;
  /** VAT component. */
  vatValue?: string;
  /** Debit-charge component. */
  drCharge?: string;
  /** Beneficiary account, MASKED server-side. Never unmask it. */
  creditAccountNo?: string;
  /** Beneficiary name, cleartext. */
  creditAccountHolder?: string;
  /** Payer name. */
  debitAccountHolder?: string;
  /** ISO-8601 UTC timestamps; index 0 is the settlement instant. */
  dateTimes?: string[];
  /** Delivery channel reported by the bank. */
  channel?: string;
  /** Platform-specific transaction type. */
  platformTransactionType?: string;
  /** Whether the credited account sits at another bank. */
  isOtherBank?: boolean;
}

/**
 * Commercial Bank of Ethiopia (CBE) Verification Adapter.
 *
 * Verifies a receipt against CBE's public transaction-detail JSON API, optionally
 * through an Ethiopian residential proxy.
 *
 * ============================================================================
 * WHY THE LEGACY `apps.cbe.com.et` / PORT-100 FLOW WAS RETIRED
 * ============================================================================
 *
 * Deleting the old portal code looks destructive without this context, so:
 *
 * 1. It never worked. The legacy endpoint only resolves a receipt when the URL
 *    is `?id={FT}{last 8 digits of the shop account}` — the customer's FT code
 *    with the last 8 digits of our receiving account appended. This bot only
 *    ever *built* `?id={FT}`, and had no way to know those 8 digits (they live
 *    in an operator-only setting, and the receipt is produced before an operator
 *    is in the loop). So a customer pasting their FT reference could not produce
 *    a working legacy URL, and neither could we. Every verification attempt on
 *    that rail was guaranteed to fail or, worse, to return a page that proves
 *    nothing about the customer's payment.
 *
 * 2. Nothing listening. `apps.cbe.com.et:443` has no listener at all; only port
 *    100 answers, and port 100 is exactly what the SSRF allow-list and the
 *    `RECEIPT_CBE_PORT` knob existed to reach. Retiring the flow also retires
 *    the reason those existed.
 *
 * 3. Nothing that worked is being removed. The rail's previous successes were
 *    impossible by construction (see 1), so this is removing dead weight, not
 *    capability.
 *
 * The `pdf-parse` dependency stays: `ingestion.service.ts` still uses it for
 * customer-uploaded PDF receipts, which is a completely separate path from bank
 * API verification.
 */
export class CbeBankAdapter extends BaseBankAdapter {
  public readonly bankRail: SupportedBank = 'cbe';

  constructor(circuitBreaker?: CircuitBreaker) {
    const { failureThreshold, cooldownMs } = resolveCircuitBreakerConfig();
    super(
      circuitBreaker || new CircuitBreaker({ name: 'cbe_adapter', failureThreshold, cooldownMs }),
      DEFAULT_BANK_NETWORK_TIMEOUT_MS
    );
  }

  /**
   * Re-reads admin-tunable circuit breaker settings (threshold + cooldown, stored in seconds)
   * and applies them to the live breaker without discarding its current state. Invoked by the
   * orchestrator façade after an Admin Dashboard settings change, so no process restart is needed.
   */
  public applyRuntimeSettings(): void {
    const { failureThreshold, cooldownMs } = resolveCircuitBreakerConfig();
    this.circuitBreaker.applyConfig({ failureThreshold, cooldownMs });
  }

  public canHandle(reference: ExtractedReceiptReference): boolean {
    if (reference.bank === 'cbe') return true;
    if (CBE_TOKEN_SEGMENT_PATTERN.test(reference.normalizedReference.trim())) return true;
    return false;
  }

  public async verify(
    reference: ExtractedReceiptReference,
    options?: BankVerificationOptions
  ): Promise<BankTransactionPayload> {
    const bypassCb = options?.bypassCircuitBreaker === true;
    this.ensureCircuitBreakerPermits(bypassCb);

    // Throws INVALID_RECEIPT_REFERENCE for a legacy `FT…` reference BEFORE any
    // egress. Rejecting locally costs no upstream call and, more importantly,
    // keeps the circuit breaker clean: an unroutable customer typo must not
    // count as a bank-portal failure and trip the breaker for everyone else.
    const targetUrl = this.buildVerificationUrl(reference);
    await this.validateSsrfHost(targetUrl, CBE_PERMITTED_HOSTNAMES, [443]);

    const timeoutMs = options?.timeoutMs || this.defaultTimeoutMs;

    // Env vars beat the dashboard setting: on Render the environment is the
    // deployment's source of truth and a stale DB row from a previous
    // deployment must not silently win over it. Mirrors the Telebirr rail.
    const proxyUrl =
      options?.proxyUrl ||
      process.env.TELEBIRR_PROXY_URL ||
      process.env.ETHIOPIA_PROXY_URL ||
      getSetting('receipt_ethiopia_proxy_url', '');

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      [CBE_APP_ID_HEADER]: CBE_APP_ID,
      [CBE_APP_VERSION_HEADER]: CBE_APP_VERSION,
    };

    let agent: HttpsProxyAgentInstance | undefined;
    if (proxyUrl && proxyUrl.trim().length > 0) {
      try {
        agent = new HttpsProxyAgent(proxyUrl.trim());
      } catch (err: unknown) {
        // Fail closed, exactly as the Telebirr rail does. Continuing with
        // `agent === undefined` would mean DIRECT egress: the operator's
        // chosen in-country IP is discarded, the request is geo-blocked, and the
        // real fault (a malformed proxy URI) resurfaces as PORTAL_GEOBLOCKED —
        // pointing the operator at a fix that cannot help.
        //
        // `proxyUrl` embeds user:pass, so it is never logged raw.
        logger.error(
          { proxyUrl: redactSecret(proxyUrl), err: err instanceof Error ? err.message : String(err) },
          'Failed to configure HttpsProxyAgent for CBE; refusing to fall back to direct egress'
        );
        throw new ProxyConfigError(
          'cbe',
          err instanceof Error ? err.message : 'proxy agent could not be constructed'
        );
      }
    }

    const hasProxy = Boolean(agent);
    const startTime = Date.now();

    return this.executeWithProtection({
      targetUrl,
      timeoutMs,
      onError: (err) => {
        // Domain outcomes are the BANK's verdict, not infrastructure noise.
        // `executeWithProtection` otherwise rewrites every throw into
        // BANK_PORTAL_UNAVAILABLE, which would tell the operator "retry later"
        // for a reference that will never verify, and would classify a rejected
        // token as an outage.
        if (
          err instanceof PortalGeoblockedError ||
          err instanceof UnconfirmedTransactionError ||
          err instanceof InvalidReceiptReferenceError
        ) {
          throw err;
        }
        if (this.isProxyFailure(err, hasProxy)) {
          throw new PortalGeoblockedError('cbe', proxyUrl || undefined);
        }
      },
      operation: async (signal) => {
        logger.info(
          { targetUrl, ref: reference.normalizedReference, hasProxy },
          'Querying upstream CBE transaction-detail API'
        );

        const { status, body } = await this.requestUpstream(targetUrl, headers, agent, signal);

        if (status === 403 || status === 451) {
          throw new PortalGeoblockedError('cbe', proxyUrl || undefined);
        }

        if (status < 200 || status >= 300) {
          const upstreamDetail = this.extractProblemDetail(body);
          if (upstreamDetail && CBE_NOT_FOUND_DETAIL_PATTERN.test(upstreamDetail)) {
            // CBE returned "transaction not found with id: ...". This happens when a
            // transfer was executed moments ago and is not yet indexed, or failed/reversed.
            // Throw UnconfirmedTransactionError so the circuit breaker is NOT tripped and
            // the order is routed cleanly to admin manual review with the bank's message.
            throw new UnconfirmedTransactionError(upstreamDetail);
          }
          if (upstreamDetail && CBE_INVALID_TOKEN_DETAIL_PATTERN.test(upstreamDetail)) {
            // A permanent customer-data fault, not an outage. Handled here
            // rather than in `onError` because the HTTP status itself carries no
            // signal: 500 is what CBE returns for a bad token AND for genuine
            // server faults, and only the `detail` text separates them.
            throw new InvalidReceiptReferenceError(reference.normalizedReference, upstreamDetail);
          }
          throw new Error(`Upstream CBE responded with HTTP ${status}`);
        }

        const payload = this.buildPayload(this.parseDetail(body), reference);

        logger.info(
          { latencyMs: Date.now() - startTime, ref: payload.transactionReference, amount: payload.amountEtb },
          'CBE confirmation verified successfully'
        );
        return payload;
      },
    });
  }

  // ============================================================================
  // URL Construction
  // ============================================================================

  /**
   * Builds the transaction-detail API URL from the reference token.
   *
   * The customer-supplied SMS link is deliberately NOT reused as the fetch
   * target. It points at the Nuxt receipt SPA, whose response is a JavaScript
   * shell containing no receipt fields; the API host serves the same receipt as
   * JSON. Fetching the API directly is what makes structured parsing (and
   * therefore fail-closed amount/status handling) possible at all.
   *
   * Throws `InvalidReceiptReferenceError` for anything that is not a `v2-`
   * token — notably the legacy `FT…` references the checkout instructions still
   * tell customers to type.
   */
  private buildVerificationUrl(reference: ExtractedReceiptReference): string {
    const token = reference.normalizedReference.trim();

    if (!CBE_TOKEN_SEGMENT_PATTERN.test(token)) {
      throw new InvalidReceiptReferenceError(
        reference.normalizedReference,
        'only the "v2-" receipt token from the CBE confirmation SMS is verifiable on this rail; the legacy FT reference format has been retired.'
      );
    }

    return `https://${CBE_API_HOST}${CBE_API_PATH_PREFIX}/${encodeURIComponent(token)}`;
  }

  /**
   * Issues the upstream GET, through the proxy tunnel when one is configured.
   *
   * Node's native `fetch` ignores `http(s).Agent`, so a proxy set on a
   * `RequestInit` is silently discarded and the request egresses directly —
   * bypassing the tunnel and the geo-block it exists to defeat. When an agent is
   * present this therefore uses `https.request`, which honours it.
   */
  private async requestUpstream(
    targetUrl: string,
    headers: Record<string, string>,
    agent: HttpsProxyAgentInstance | undefined,
    signal: AbortSignal
  ): Promise<{ status: number; body: string }> {
    if (!agent) {
      const response = await fetch(targetUrl, { signal, headers });
      return { status: response.status, body: await response.text() };
    }

    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = https.request(
        targetUrl,
        { method: 'GET', headers, agent: agent as never, signal },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode || 200,
              body: Buffer.concat(chunks).toString('utf-8'),
            })
          );
        }
      );
      req.on('error', (err) => reject(err));
      req.end();
    });
  }

  /**
   * Classifies a transport error as a residential-proxy egress failure.
   *
   * Only meaningful when a proxy is actually configured. Without one, a timeout
   * or refused connection is ordinary upstream unavailability and must NOT be
   * rewritten to PORTAL_GEOBLOCKED — that misdiagnosis told administrators the
   * bank was geo-blocking us when the portal had simply timed out.
   */
  private isProxyFailure(err: unknown, hasProxy: boolean): boolean {
    if (!hasProxy) return false;
    if (!err || typeof err !== 'object') return false;
    const msg = (err as { message?: string }).message?.toLowerCase() || '';
    const code = (err as { code?: string }).code;
    return Boolean(
      msg.includes('proxy') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT'
    );
  }

  // ============================================================================
  // Response Parsing
  // ============================================================================

  /** Parses the success body, failing loudly rather than returning a hollow object. */
  private parseDetail(body: string): CbeTransactionDetail {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not a JSON object');
      }
      return parsed as CbeTransactionDetail;
    } catch (err: unknown) {
      throw new Error(
        `Upstream CBE response was not a transaction-detail object: ${
          err instanceof Error ? err.message : 'unparseable'
        }`
      );
    }
  }

  /**
   * Pulls the RFC 7807 `detail` out of an error body, if there is one.
   *
   * Returns `null` for a non-JSON or detail-less body so the caller can fall
   * through to the generic outage path — the absence of a readable `detail` is
   * not evidence of a bad token.
   */
  private extractProblemDetail(body: string): string | null {
    try {
      const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown };
      if (parsed && typeof parsed.detail === 'string' && parsed.detail.trim().length > 0) {
        return parsed.detail.trim();
      }
      if (parsed && typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
        return parsed.message.trim();
      }
    } catch {
      // Non-JSON error body (HTML error page, plain text): treat as opaque.
    }
    return null;
  }

  private buildPayload(
    detail: CbeTransactionDetail,
    reference: ExtractedReceiptReference
  ): BankTransactionPayload {
    // F1: a receipt only confirms a payment if the bank says it completed. The
    // API carries `status` on every successful response, so requiring it costs
    // nothing and closes the gap where a well-formed-but-unsettled transaction
    // document was paired with the customer's own claimed amount. Mirrors the
    // Telebirr rail's identical guard.
    const status = (detail.status || '').trim();
    if (status !== CBE_STATUS_COMPLETED) {
      throw new UnconfirmedTransactionError(
        status
          ? `CBE reported this transaction with status "${status}", not "${CBE_STATUS_COMPLETED}".`
          : `CBE returned no transaction status for reference '${reference.normalizedReference}', so the payment cannot be confirmed as completed.`
      );
    }

    const amountEtb = this.parseNumeric(detail.amountCredited);
    const feeEtb = this.extractFeeEtb(detail);

    return {
      bank: 'cbe',
      // From the bank's own document, never the customer-supplied token: the
      // API's `id` is a 12-character transaction id and the request token is 23
      // characters, so string equality between the two is impossible. The
      // binding is the `status` check above; the reference that reaches the
      // anti-replay index is the one the bank itself published.
      transactionReference: (detail.id || '').trim(),
      amountEtb,
      feeEtb,
      currency: 'ETB',
      senderName: this.cleanOptional(detail.debitAccountHolder),
      senderIdentifier: undefined,
      // Preserved EXACTLY as received, asterisks included.
      //
      // The API masks `creditAccountNo` server-side and exposes no unmasked
      // account number anywhere, so the mask is not noise to be stripped — it
      // IS the only account evidence available. Telebirr's rail keeps the mask
      // for the same reason: stripping it yields a digit string that can never
      // equal the operator-configured account, failing every genuine receipt.
      beneficiaryAccount: (detail.creditAccountNo || '').trim(),
      // No fabricated fallback.
      //
      // This used to yield the literal 'Bighabesha Shop' on a parse miss, which
      // is the most dangerous possible default: it makes a name-based pillar
      // compare the shop's own name against itself and pass EVERY receipt,
      // including one credited to a stranger. A missing name must read as "the
      // bank told us nothing", which the name pillar treats as a non-match.
      beneficiaryName: this.cleanOptional(detail.creditAccountHolder) || '',
      transactionTimestamp: this.extractTimestamp(detail),
      transactionStatus: status,
      paymentChannel: this.extractPaymentChannel(detail),
      rawAuditTrail: {
        source: 'cbe_transaction_detail_api',
        transactionId: detail.id,
        status,
        isOtherBank: detail.isOtherBank === true,
        amountDebitedWithCurrency: detail.amountDebited ?? null,
        amountCreditedWithCurrency: detail.amountCredited ?? null,
        totalChargeAmountWithCurrency: detail.totalChargeAmount ?? null,
        totalTaxAmountWithCurrency: detail.totalTaxAmount ?? null,
        serviceCharge: detail.serviceChargeValue ?? null,
        vat: detail.vatValue ?? null,
        parsedAt: new Date().toISOString(),
      },
    };
  }

  // ============================================================================
  // Field Extractors (SRP Decomposition)
  // ============================================================================

  /**
   * Parses a numeric string from the API, failing closed on anything unusable.
   *
   * Returns 0 rather than throwing for the AMOUNT specifically, because the
   * amount pillar compares against the order total: 0 cannot meet any non-zero
   * total, so the order is routed to manual review instead of being fulfilled on
   * an unproven figure.
   *
   * The customer-supplied `reference.amountEtb` is NEVER a fallback. That value
   * comes from the buyer's own SMS text, so trusting it would mean the buyer
   * attests their own payment — the exact hole the amount pillar exists to close.
   */
  private parseNumeric(raw: string | undefined): number {
    if (raw === undefined || raw === null) return 0;
    const parsed = parseFloat(String(raw).replace(NON_AMOUNT_CHARS_PATTERN, ''));
    if (isNaN(parsed) || parsed < 0) return 0;
    return parsed;
  }

  /**
   * Total fee the customer actually paid: charges plus tax.
   *
   * `totalChargeAmount` / `totalTaxAmount` are the authoritative aggregates.
   * `serviceChargeValue`, `vatValue` and `drCharge` are their components and are
   * only consulted when an aggregate is missing, otherwise the same money would
   * be counted twice.
   *
   * The previous implementation hardcoded 0, so every CBE receipt in the audit
   * ledger understated what the customer was charged.
   */
  private extractFeeEtb(detail: CbeTransactionDetail): number {
    const charges = this.parseNumeric(detail.totalChargeAmount);
    const tax = this.parseNumeric(detail.totalTaxAmount);
    if (charges > 0 || tax > 0) return charges + tax;

    const components = [detail.serviceChargeValue, detail.vatValue, detail.drCharge];
    return components.reduce<number>((sum, value) => sum + this.parseNumeric(value), 0);
  }

  /**
   * Reads the settlement instant from `dateTimes[0]`.
   *
   * That entry is the only value in the response with a time component AND an
   * explicit UTC offset (`...Z`), which `parseEthiopianBankTimestamp` already
   * handles on its explicit-offset branch. The compact `YYYYMMDD` fields
   * (`processingDate`, `debitValueDate`, `creditValueDate`, `authDate`) carry a
   * date only, so using one of them would anchor the recency window on midnight
   * and reject genuine same-day payments.
   */
  private extractTimestamp(detail: CbeTransactionDetail): Date | null {
    const first = Array.isArray(detail.dateTimes) ? detail.dateTimes[0] : undefined;
    if (typeof first !== 'string' || first.trim().length === 0) {
      // Fail closed: `null` cannot satisfy the recency pillar, so the order goes
      // to manual review. Substituting "now" would let any receipt pass.
      return null;
    }
    return parseEthiopianBankTimestamp(first.trim());
  }

  /** Reports the bank's own channel rather than a hardcoded label. */
  private extractPaymentChannel(detail: CbeTransactionDetail): string {
    const parts = [detail.channel, detail.platformTransactionType]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v) => v.length > 0);
    return parts.length > 0 ? parts.join('/') : 'cbe_transaction_detail_api';
  }

  private cleanOptional(raw: string | undefined): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
}