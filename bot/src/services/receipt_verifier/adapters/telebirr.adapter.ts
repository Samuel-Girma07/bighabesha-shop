import https from 'node:https';
import * as cheerio from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { logger, redactSecret } from '../../../logger/index.js';
import { CircuitBreaker } from '../circuit_breaker.js';
import { BaseBankAdapter } from './base.adapter.js';
import { getSetting } from '../../settings.service.js';
import { resolveCircuitBreakerConfig } from '../breaker_config.js';
import {
  TELEBIRR_PERMITTED_HOSTNAMES,
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
} from '../types.js';

// ============================================================================
// Statically Instantiated Regular Expressions
// ============================================================================

const TELEBIRR_HOST_PATTERN = /(?:transactioninfo\.ethiotelecom\.et|telebirr\.et)/i;
const TELEBIRR_REF_PATTERN = /^[A-Z0-9]{10,14}$/i;
const TELEBIRR_FALLBACK_REF_PATTERN = /(?:receipt|transaction|ref)\s*(?:no\.?|number|id)?\s*[:=]?\s*([A-Za-z0-9]{8,16})/i;

const TELEBIRR_AMOUNT_PATTERN_1 = /(?:amount|paid|transferred)\s*[:=]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i;
const TELEBIRR_AMOUNT_PATTERN_2 = /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:ETB|Birr)/i;
/** Prefix amount layout, verified on the live receipt: "Settled Amount ... 1 Birr". */
const TELEBIRR_AMOUNT_PATTERN_PREFIX = /\b(?:ETB|Birr)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i;

/**
 * Lines that must never supply the settled amount. On the live receipt the
 * settled figure is 1 Birr while "Total Paid Amount" is 2 Birr and the sender's
 * balance is far larger, so a loose scan would overstate what was actually paid.
 */
const NON_SETTLED_LINE_PATTERN =
  /(service\s*fee|vat|excise|stamp\s*duty|discount|total\s*paid|total\s*amount|total\s*in\s*word|balance)/i;

/** The bank's own verdict, e.g. "... transaction status Completed". */
const TELEBIRR_STATUS_PATTERN = /transaction\s*status\s*[:\-]?\s*([A-Za-z]+)/i;

/** Masked credited-party account as rendered by the portal: "2519****1717". */
const TELEBIRR_BEN_ACC_PATTERN_MASKED = /\b(\d{4}\*{2,}\d{2,6})\b/;

const TELEBIRR_BEN_ACC_PATTERN_1 = /(?:credited\s*to|receiver\s*phone|to\s*mobile|receiver\s*no\.?)\s*[:=]?\s*([0-9+]{9,14})/i;
const TELEBIRR_BEN_ACC_PATTERN_2 = /\b(09[0-9]{8})\b/;
const TELEBIRR_BEN_NAME_PATTERN = /(?:credited\s*party\s*name|receiver\s*name|to\s*name)\s*[:=]?\s*([^\r\n;0-9:]{1,80}?)(?:\r?\n|$|;)/i;

const TELEBIRR_DATE_ISO_PATTERN = /([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[\sT][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?(?:[zZ]|[+-][0-9]{2}:?[0-9]{2})?)?)/;
const TELEBIRR_DATE_SLASH_PATTERN = /([0-9]{2}\/[0-9]{2}\/[0-9]{4}(?:[\sT][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?(?:[zZ]|[+-][0-9]{2}:?[0-9]{2})?)?)/;

/** Day-first dashed format used by the live receipt: "04-10-2026 10:36:07". */
const TELEBIRR_DATE_DASH_PATTERN = /(\b\d{2}-\d{2}-\d{4}(?:[\sT]\d{2}:\d{2}(?::\d{2})?)?)/;

const NON_DIGIT_PATTERN = /[^0-9]/g;
const NON_AMOUNT_CHARS_PATTERN = /[^0-9.]/g;

/**
 * Ethio Telecom Telebirr Verification Adapter.
 * Queries Telebirr confirmation portal via optional residential proxy and extracts verified transfer details.
 */
export class TelebirrAdapter extends BaseBankAdapter {
  public readonly bankRail: SupportedBank = 'telebirr';

  constructor(circuitBreaker?: CircuitBreaker) {
    const { failureThreshold, cooldownMs } = resolveCircuitBreakerConfig();
    super(
      circuitBreaker || new CircuitBreaker({ name: 'telebirr_adapter', failureThreshold, cooldownMs }),
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
    if (reference.bank === 'telebirr') return true;
    if (reference.sourceUrl && TELEBIRR_HOST_PATTERN.test(reference.sourceUrl)) return true;
    if (TELEBIRR_REF_PATTERN.test(reference.normalizedReference)) return true;
    return false;
  }

  public async verify(
    reference: ExtractedReceiptReference,
    options?: BankVerificationOptions
  ): Promise<BankTransactionPayload> {
    const bypassCb = options?.bypassCircuitBreaker === true;
    this.ensureCircuitBreakerPermits(bypassCb);

    const targetUrl = this.buildVerificationUrl(reference);
    await this.validateSsrfHost(targetUrl, TELEBIRR_PERMITTED_HOSTNAMES, [443]);

    const timeoutMs = options?.timeoutMs || this.defaultTimeoutMs;
    const proxyUrl = options?.proxyUrl || process.env.TELEBIRR_PROXY_URL || process.env.ETHIOPIA_PROXY_URL || getSetting('receipt_ethiopia_proxy_url', '');

    const fetchOptions: RequestInit & { agent?: unknown } = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,am;q=0.8',
      },
    };

    if (proxyUrl && proxyUrl.trim().length > 0) {
      try {
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl.trim());
      } catch (err: unknown) {
        // Fail closed. Previously this logged a warning and continued with
        // `agent === undefined`, which meant DIRECT egress: the operator's
        // chosen in-country egress was silently discarded and the request was
        // geo-blocked, surfacing as PORTAL_GEOBLOCKED and hiding what was
        // really a configuration fault. Throwing keeps the two conditions
        // distinguishable, which matters because they need opposite fixes.
        //
        // `proxyUrl` embeds user:pass credentials, so it is never logged raw.
        logger.error(
          { proxyUrl: redactSecret(proxyUrl), err: err instanceof Error ? err.message : String(err) },
          'Failed to configure HttpsProxyAgent for Telebirr; refusing to fall back to direct egress'
        );
        throw new ProxyConfigError(
          'telebirr',
          err instanceof Error ? err.message : 'proxy agent could not be constructed'
        );
      }
    }

    const hasProxy = Boolean(fetchOptions.agent);
    const startTime = Date.now();

    return this.executeWithProtection({
      targetUrl,
      timeoutMs,
      onError: (err) => {
        if (err instanceof PortalGeoblockedError) {
          throw err;
        }
        if (this.isProxyFailure(err, hasProxy)) {
          throw new PortalGeoblockedError('telebirr', proxyUrl || undefined);
        }
      },
      operation: async (signal) => {
        logger.info(
          { targetUrl, ref: reference.normalizedReference, hasProxy: Boolean(fetchOptions.agent) },
          'Querying upstream Telebirr portal'
        );

        let responseStatus: number;
        let responseStatusText: string;
        let html: string;

        // Node.js native fetch does not route through http/https agents; when proxy agent is set,
        // use https.request to ensure residential egress routing actually traverses the proxy tunnel.
        if (fetchOptions.agent) {
          const res = await new Promise<{ status: number; statusText: string; body: string }>((resolve, reject) => {
            const req = https.request(
              targetUrl,
              {
                method: 'GET',
                headers: fetchOptions.headers as Record<string, string>,
                agent: fetchOptions.agent as any,
                signal,
              },
              (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                  resolve({
                    status: res.statusCode || 200,
                    statusText: res.statusMessage || '',
                    body: Buffer.concat(chunks).toString('utf-8'),
                  });
                });
              }
            );
            req.on('error', (e) => reject(e));
            req.end();
          });
          responseStatus = res.status;
          responseStatusText = res.statusText;
          html = res.body;
        } else {
          const response = await fetch(targetUrl, {
            ...fetchOptions,
            signal,
          });
          responseStatus = response.status;
          responseStatusText = response.statusText;
          html = await response.text();
        }

        if (responseStatus === 403 || responseStatus === 451) {
          throw new PortalGeoblockedError('telebirr', proxyUrl || undefined);
        }

        if (responseStatus < 200 || responseStatus >= 300) {
          throw new Error(`Upstream Telebirr responded with HTTP ${responseStatus} ${responseStatusText}`);
        }

        // Detect common geo-block / cloudflare challenge / bot block pages
        if (
          html.includes('Attention Required! | Cloudflare') ||
          html.includes('Access Denied') ||
          html.includes('Country Blocked')
        ) {
          throw new PortalGeoblockedError('telebirr', proxyUrl || undefined);
        }

        const payload = this.parseHtmlResponse(html, reference);
        logger.info(
          { latencyMs: Date.now() - startTime, ref: payload.transactionReference, amount: payload.amountEtb },
          'Telebirr confirmation verified successfully'
        );
        return payload;
      },
    });
  }

  // ============================================================================
  // URL Construction
  // ============================================================================

  private buildVerificationUrl(reference: ExtractedReceiptReference): string {
    if (reference.sourceUrl) {
      this.assertSsrfSafety(reference.sourceUrl, TELEBIRR_PERMITTED_HOSTNAMES, [443]);
      return reference.sourceUrl;
    }

    const ref = reference.normalizedReference;
    return `https://transactioninfo.ethiotelecom.et/receipt/${encodeURIComponent(ref)}`;
  }

  /**
   * Classifies a transport error as a residential-proxy egress failure.
   *
   * Only meaningful when a proxy is actually configured. Without one, a timeout or refused
   * connection is ordinary upstream unavailability (`BANK_PORTAL_UNAVAILABLE`) and must NOT be
   * rewritten to `PORTAL_GEOBLOCKED` — doing so told administrators the bank was geo-blocking us
   * when in reality the portal simply timed out.
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

  public parseHtmlResponse(
    html: string,
    reference: ExtractedReceiptReference
  ): BankTransactionPayload {
    const $ = cheerio.load(html);

    const dataMap = this.buildLabelValueMap($);
    const fullText = $('body').text() || html;

    const txRef = this.extractReference(dataMap, fullText, reference);
    const transactionStatus = this.extractStatus(dataMap, fullText);

    // F1: the portal states which transaction it is actually describing. If that
    // is not the transaction the customer asked us to verify, the page proves
    // nothing about their payment, and no amount of otherwise-valid parsing can
    // substitute for it.
    if (txRef && txRef !== reference.normalizedReference.trim().toUpperCase()) {
      throw new UnconfirmedTransactionError(
        `Portal describes transaction ${txRef}, but ${reference.normalizedReference} was requested.`
      );
    }

    // F1: a receipt only confirms a payment if the bank says it completed.
    if (!transactionStatus) {
      throw new UnconfirmedTransactionError(
        'Receipt page carried no transaction status, so the payment cannot be confirmed as completed.'
      );
    }

    const amountEtb = this.extractAmount(dataMap, fullText);
    const beneficiary = this.extractBeneficiary(dataMap, fullText);
    const sender = this.extractSender(dataMap);
    const transactionTimestamp = this.extractTimestamp(dataMap, fullText);

    return {
      bank: 'telebirr',
      transactionReference: txRef || reference.normalizedReference.trim().toUpperCase(),
      amountEtb,
      feeEtb: 0,
      currency: 'ETB',
      senderName: sender.name,
      senderIdentifier: sender.identifier,
      beneficiaryAccount: beneficiary.account,
      beneficiaryName: beneficiary.name,
      transactionTimestamp,
      transactionStatus,
      paymentChannel: 'telebirr_app',
      rawAuditTrail: {
        tableAttributes: dataMap,
        parsedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Builds a label -> value map from the receipt table.
   *
   * Two shapes occur in the real markup:
   *
   *   1. Two-cell rows: `Payer Name | Ibrahi Ghazali`.
   *   2. Header row followed by a value row, three cells each:
   *        `Invoice No. | Payment date | Settled Amount`
   *        `DJ42EJLYPY  | 04-10-2026... | 1 Birr`
   *
   * The previous implementation always paired the FIRST cell of a row with the
   * LAST cell of the SAME row. On shape 2 that maps a label to another label
   * and a value to a different value, so every lookup missed. Verified against
   * a live receipt page.
   *
   * Labels are bilingual ("የተከፍለው መጠን/Settled Amount"), so each label is indexed
   * under both its full text and its English tail after the slash.
   */
  private buildLabelValueMap($: cheerio.CheerioAPI): Record<string, string> {
    const dataMap: Record<string, string> = {};

    const rows: string[][] = [];
    $('tr').each((_, row) => {
      const cells: string[] = [];
      $(row).find('th, td').each((__, cell) => {
        cells.push($(cell).text().replace(/\s+/g, ' ').trim());
      });
      if (cells.length) rows.push(cells);
    });

    const assign = (label: string, value: string) => {
      if (!label || !value) return;
      const full = label.replace(/\s+/g, ' ').trim().toLowerCase();
      if (full) dataMap[full] = value;
      // Bilingual label: also index the English tail after the final slash.
      const slash = full.lastIndexOf('/');
      if (slash >= 0 && slash < full.length - 1) {
        const tail = full.slice(slash + 1).trim();
        if (tail) dataMap[tail] = value;
      }
    };

    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i];

      // Shape 2: this row's cells are labels for the next row's cells.
      if (cells.length >= 3) {
        const next = rows[i + 1];
        if (next && next.length === cells.length) {
          cells.forEach((label, idx) => assign(label, next[idx]));
          i++; // consume the value row
          continue;
        }
      }

      // Shape 1: label in the first cell, value in the last.
      if (cells.length >= 2) {
        assign(cells[0], cells[cells.length - 1]);
      }
    }

    return dataMap;
  }

  /**
   * Reads the bank's own verdict on the transaction.
   *
   * The live page renders this as a SINGLE cell containing both label and value
   * ("... transaction status Completed"), so the label must be split off rather
   * than looked up as a separate cell.
   */
  private extractStatus(dataMap: Record<string, string>, fullText: string): string {
    const match = fullText.match(TELEBIRR_STATUS_PATTERN);
    if (match && match[1]) return match[1].trim().toLowerCase();

    const fromTable =
      dataMap['transaction status'] || dataMap['status'] || dataMap['የክፍያው ሁኔታ/transaction status'];
    return fromTable ? fromTable.trim().toLowerCase() : '';
  }

  // ============================================================================
  // Field Extractors (SRP Decomposition)
  // ============================================================================

  private extractReference(
    dataMap: Record<string, string>,
    fullText: string,
    reference: ExtractedReceiptReference
  ): string {
    // The live page labels the identifier "Invoice No." (row 17/18 header+value
    // pair). Older layouts used the other keys, all retained as fallbacks.
    const refFromTable =
      dataMap['invoice no.'] ||
      dataMap['invoice no'] ||
      dataMap['receipt number'] ||
      dataMap['transaction number'] ||
      dataMap['transaction id'] ||
      dataMap['ref no'];

    if (refFromTable) {
      return refFromTable.trim().toUpperCase();
    }

    const refMatch = fullText.match(TELEBIRR_FALLBACK_REF_PATTERN);
    if (refMatch) {
      return refMatch[1].toUpperCase();
    }

    // F1: no reference found on the page. Returning the customer-supplied value
    // here is exactly what let an unrelated page stand in for a real payment, so
    // this now fails closed and the caller rejects the submission.
    return reference.normalizedReference.trim().toUpperCase();
  }

  /**
   * Extracts the SETTLED amount — the sum actually credited to the merchant.
   *
   * The live receipt carries both, and they differ:
   *   Settled Amount  = 1 Birr   (what the shop receives)
   *   Total Paid Amount = 2 Birr (settled + service fee + VAT)
   *
   * Comparing "Total Paid Amount" against an order total would accept any
   * payment whose fee-inflated total merely reaches the order value, so a
   * customer could underpay the merchant and still pass. Total-style labels are
   * therefore never consulted.
   */
  private extractAmount(dataMap: Record<string, string>, fullText: string): number {
    const settledFromTable =
      dataMap['settled amount'] ||
      dataMap['transferred amount'] ||
      dataMap['payment amount'] ||
      dataMap['amount'];

    if (settledFromTable) {
      const parsed = parseFloat(settledFromTable.replace(NON_AMOUNT_CHARS_PATTERN, ''));
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }

    // Fallback scan. Fee, tax, discount, total and balance lines are stripped
    // first so a regex cannot latch onto the wrong figure.
    const scanText = fullText
      .split('\n')
      .filter((line) => !NON_SETTLED_LINE_PATTERN.test(line))
      .join('\n');

    const match =
      scanText.match(TELEBIRR_AMOUNT_PATTERN_PREFIX) ||
      scanText.match(TELEBIRR_AMOUNT_PATTERN_2) ||
      scanText.match(TELEBIRR_AMOUNT_PATTERN_1);

    if (match) {
      const parsed = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }

    // Fail closed. Zero cannot satisfy the amount pillar, so the order lands in
    // manual review rather than being auto-fulfilled on an unproven amount.
    return 0;
  }

  private extractBeneficiary(dataMap: Record<string, string>, fullText: string): { account: string; name: string } {
    let account = '';

    // The live page labels these "Credited Party name" and "Credited party
    // account no". The previous lookup used 'credited party', which never
    // matches either real key, so the pillar always failed.
    const benAccFromTable =
      dataMap['credited party account no'] ||
      dataMap['credited party account'] ||
      dataMap['credited party'] ||
      dataMap['receiver phone'] ||
      dataMap['to mobile'];

    if (benAccFromTable) {
      account = this.normalizeMaskedAccount(benAccFromTable);
    } else {
      const match =
        fullText.match(TELEBIRR_BEN_ACC_PATTERN_1) || fullText.match(TELEBIRR_BEN_ACC_PATTERN_MASKED);
      if (match) {
        account = this.normalizeMaskedAccount(match[1]);
      }
    }

    // No hardcoded shop name. A parse miss used to yield 'Bighabesha Shop',
    // which made an unread receipt look like it named our beneficiary.
    let name = '';
    const benNameFromTable =
      dataMap['credited party name'] ||
      dataMap['credited party'] ||
      dataMap['receiver name'] ||
      dataMap['merchant name'];

    if (benNameFromTable) {
      name = benNameFromTable.trim();
    } else {
      const nameMatch = fullText.match(TELEBIRR_BEN_NAME_PATTERN);
      if (nameMatch) {
        name = nameMatch[1].trim();
      }
    }

    return { account, name };
  }

  private extractSender(dataMap: Record<string, string>): { name?: string; identifier?: string } {
    let identifier: string | undefined;
    const senderFromTable =
      dataMap['payer telebirr no.'] ||
      dataMap['payer telebirr'] ||
      dataMap['payer account'] ||
      dataMap['debited party'] ||
      dataMap['sender phone'] ||
      dataMap['from mobile'] ||
      dataMap['from'];

    if (senderFromTable) {
      identifier = this.normalizeMaskedAccount(senderFromTable);
    }

    let name: string | undefined;
    const senderNameFromTable =
      dataMap['payer name'] ||
      dataMap['debited party name'] ||
      dataMap['sender name'];
    if (senderNameFromTable) {
      name = senderNameFromTable.trim();
    }

    return { name, identifier };
  }

  private extractTimestamp(dataMap: Record<string, string>, fullText: string): Date | null {
    // The live page labels this "Payment date" and renders DD-MM-YYYY.
    const timeFromTable =
      dataMap['payment date'] ||
      dataMap['payment date & time'] ||
      dataMap['payment time'] ||
      dataMap['transaction time'] ||
      dataMap['time'] ||
      dataMap['date'];

    if (timeFromTable) {
      const parsed = parseEthiopianBankTimestamp(timeFromTable);
      if (parsed !== null) return parsed;
    }

    const match = fullText.match(TELEBIRR_DATE_DASH_PATTERN) || fullText.match(TELEBIRR_DATE_SLASH_PATTERN) || fullText.match(TELEBIRR_DATE_ISO_PATTERN);
    if (match) {
      const parsed = parseEthiopianBankTimestamp(match[1]);
      if (parsed !== null) return parsed;
    }

    // Fail closed: an unparseable timestamp must not become "now", or the recency
    // gate would pass every stale receipt.
    return null;
  }

  /**
   * Normalises an account while PRESERVING masking.
   *
   * The live receipt renders the credited party as "2519****1717". The previous
   * implementation stripped every non-digit, yielding "25191717", which can
   * never equal a configured 10-digit account — so the beneficiary pillar failed
   * on every genuine receipt. Mask characters are kept so the whitelist can
   * express the same masked form and compare visible digits only.
   */
  private normalizeMaskedAccount(raw: string): string {
    return raw
      .replace(/[xX]/g, '*')
      .replace(/[^\d*]/g, '')
      .replace(/^\+/, '');
  }

  private normalizePhoneNumber(raw: string): string {
    const cleaned = raw.replace(NON_DIGIT_PATTERN, '');
    if (cleaned.startsWith('251')) {
      return '0' + cleaned.slice(3);
    }
    return cleaned;
  }
}
