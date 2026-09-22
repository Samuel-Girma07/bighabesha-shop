import https from 'node:https';
import * as cheerio from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { logger } from '../../../logger/index.js';
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
} from '../types.js';

// ============================================================================
// Statically Instantiated Regular Expressions
// ============================================================================

const TELEBIRR_HOST_PATTERN = /(?:transactioninfo\.ethiotelecom\.et|telebirr\.et)/i;
const TELEBIRR_REF_PATTERN = /^[A-Z0-9]{10,14}$/i;
const TELEBIRR_FALLBACK_REF_PATTERN = /(?:receipt|transaction|ref)\s*(?:no\.?|number|id)?\s*[:=]?\s*([A-Za-z0-9]{8,16})/i;

const TELEBIRR_AMOUNT_PATTERN_1 = /(?:amount|paid|transferred)\s*[:=]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i;
const TELEBIRR_AMOUNT_PATTERN_2 = /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:ETB|Birr)/i;

const TELEBIRR_BEN_ACC_PATTERN_1 = /(?:credited\s*to|receiver\s*phone|to\s*mobile|receiver\s*no\.?)\s*[:=]?\s*([0-9+]{9,14})/i;
const TELEBIRR_BEN_ACC_PATTERN_2 = /\b(09[0-9]{8})\b/;
const TELEBIRR_BEN_NAME_PATTERN = /(?:credited\s*party\s*name|receiver\s*name|to\s*name)\s*[:=]?\s*([^\r\n;0-9:]{1,80}?)(?:\r?\n|$|;)/i;

const TELEBIRR_DATE_ISO_PATTERN = /([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[\sT][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?(?:[zZ]|[+-][0-9]{2}:?[0-9]{2})?)?)/;
const TELEBIRR_DATE_SLASH_PATTERN = /([0-9]{2}\/[0-9]{2}\/[0-9]{4}(?:[\sT][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?(?:[zZ]|[+-][0-9]{2}:?[0-9]{2})?)?)/;

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
        logger.warn({ proxyUrl, err: err instanceof Error ? err.message : String(err) }, 'Failed to configure HttpsProxyAgent for Telebirr');
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

    // Extract table key-value pairs or structured labels
    const dataMap: Record<string, string> = {};
    $('tr').each((_, row) => {
      const th = $(row).find('th, td:first-child').text().trim().toLowerCase();
      const td = $(row).find('td:last-child').text().trim();
      if (th && td) {
        dataMap[th] = td;
      }
    });

    const fullText = $('body').text() || html;

    const txRef = this.extractReference(dataMap, fullText, reference.normalizedReference);
    const amountEtb = this.extractAmount(dataMap, fullText, reference.amountEtb);
    const beneficiary = this.extractBeneficiary(dataMap, fullText);
    const sender = this.extractSender(dataMap);
    const transactionTimestamp = this.extractTimestamp(dataMap, fullText);

    return {
      bank: 'telebirr',
      transactionReference: txRef,
      amountEtb,
      feeEtb: 0,
      currency: 'ETB',
      senderName: sender.name,
      senderIdentifier: sender.identifier,
      beneficiaryAccount: beneficiary.account,
      beneficiaryName: beneficiary.name,
      transactionTimestamp,
      paymentChannel: 'telebirr_app',
      rawAuditTrail: {
        tableAttributes: dataMap,
        parsedAt: new Date().toISOString(),
      },
    };
  }

  // ============================================================================
  // Field Extractors (SRP Decomposition)
  // ============================================================================

  private extractReference(dataMap: Record<string, string>, fullText: string, fallbackRef: string): string {
    const refFromTable =
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

    return fallbackRef;
  }

  private extractAmount(dataMap: Record<string, string>, fullText: string, fallbackAmount?: number): number {
    const amountFromTable =
      dataMap['amount'] ||
      dataMap['transferred amount'] ||
      dataMap['payment amount'] ||
      dataMap['total amount'];

    if (amountFromTable) {
      const parsed = parseFloat(amountFromTable.replace(NON_AMOUNT_CHARS_PATTERN, ''));
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }

    const match = fullText.match(TELEBIRR_AMOUNT_PATTERN_1) || fullText.match(TELEBIRR_AMOUNT_PATTERN_2);
    if (match) {
      const parsed = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }

    return fallbackAmount || 0;
  }

  private extractBeneficiary(dataMap: Record<string, string>, fullText: string): { account: string; name: string } {
    let account = '';
    const benAccFromTable =
      dataMap['credited party'] ||
      dataMap['receiver phone'] ||
      dataMap['to mobile'] ||
      dataMap['creditor account'] ||
      dataMap['to'];

    if (benAccFromTable) {
      account = this.normalizePhoneNumber(benAccFromTable);
    } else {
      const match = fullText.match(TELEBIRR_BEN_ACC_PATTERN_1) || fullText.match(TELEBIRR_BEN_ACC_PATTERN_2);
      if (match) {
        account = this.normalizePhoneNumber(match[1]);
      }
    }

    let name = 'Bighabesha Shop';
    const benNameFromTable =
      dataMap['credited party name'] ||
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
      dataMap['debited party'] ||
      dataMap['sender phone'] ||
      dataMap['from mobile'] ||
      dataMap['from'];

    if (senderFromTable) {
      identifier = this.normalizePhoneNumber(senderFromTable);
    }

    let name: string | undefined;
    const senderNameFromTable = dataMap['debited party name'] || dataMap['sender name'];
    if (senderNameFromTable) {
      name = senderNameFromTable.trim();
    }

    return { name, identifier };
  }

  private extractTimestamp(dataMap: Record<string, string>, fullText: string): Date {
    const timeFromTable =
      dataMap['payment time'] ||
      dataMap['transaction time'] ||
      dataMap['time'] ||
      dataMap['date'];

    if (timeFromTable) {
      const parsed = parseEthiopianBankTimestamp(timeFromTable);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    const match = fullText.match(TELEBIRR_DATE_ISO_PATTERN) || fullText.match(TELEBIRR_DATE_SLASH_PATTERN);
    if (match) {
      const parsed = parseEthiopianBankTimestamp(match[1]);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    return new Date();
  }

  private normalizePhoneNumber(raw: string): string {
    const cleaned = raw.replace(NON_DIGIT_PATTERN, '');
    if (cleaned.startsWith('251')) {
      return '0' + cleaned.slice(3);
    }
    return cleaned;
  }
}
