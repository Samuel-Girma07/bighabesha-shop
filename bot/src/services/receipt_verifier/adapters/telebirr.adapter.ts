import * as cheerio from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { logger } from '../../../logger/index.js';
import { CircuitBreaker } from '../circuit_breaker.js';
import { BaseBankAdapter } from './base.adapter.js';
import { getSetting } from '../../settings.service.js';
import {
  TELEBIRR_PERMITTED_HOSTNAMES,
  DEFAULT_BANK_NETWORK_TIMEOUT_MS,
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

const TELEBIRR_DATE_ISO_PATTERN = /([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[\sT][0-9]{2}:[0-9]{2}:[0-9]{2})?)/;
const TELEBIRR_DATE_SLASH_PATTERN = /([0-9]{2}\/[0-9]{2}\/[0-9]{4}(?:[\sT][0-9]{2}:[0-9]{2}:[0-9]{2})?)/;

const NON_DIGIT_PATTERN = /[^0-9]/g;
const NON_AMOUNT_CHARS_PATTERN = /[^0-9.]/g;

/**
 * Ethio Telecom Telebirr Verification Adapter.
 * Queries Telebirr confirmation portal via optional residential proxy and extracts verified transfer details.
 */
export class TelebirrAdapter extends BaseBankAdapter {
  public readonly bankRail: SupportedBank = 'telebirr';

  constructor(circuitBreaker?: CircuitBreaker) {
    super(
      circuitBreaker || new CircuitBreaker({ name: 'telebirr_adapter', failureThreshold: 3, cooldownMs: 60_000 }),
      DEFAULT_BANK_NETWORK_TIMEOUT_MS
    );
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

    const startTime = Date.now();

    return this.executeWithProtection({
      targetUrl,
      timeoutMs,
      onError: (err) => {
        if (err instanceof PortalGeoblockedError) {
          throw err;
        }
        if (this.isProxyFailure(err)) {
          throw new PortalGeoblockedError('telebirr', proxyUrl || undefined);
        }
      },
      operation: async (signal) => {
        logger.info(
          { targetUrl, ref: reference.normalizedReference, hasProxy: Boolean(fetchOptions.agent) },
          'Querying upstream Telebirr portal'
        );

        const response = await fetch(targetUrl, {
          ...fetchOptions,
          signal,
        });

        if (response.status === 403 || response.status === 451) {
          throw new PortalGeoblockedError('telebirr', proxyUrl || undefined);
        }

        if (!response.ok) {
          throw new Error(`Upstream Telebirr responded with HTTP ${response.status} ${response.statusText}`);
        }

        const html = await response.text();

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

  private isProxyFailure(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const msg = (err as { message?: string }).message;
    const code = (err as { code?: string }).code;
    return Boolean((msg && msg.includes('proxy')) || code === 'ECONNRESET');
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
      const parsed = new Date(timeFromTable);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    const match = fullText.match(TELEBIRR_DATE_ISO_PATTERN) || fullText.match(TELEBIRR_DATE_SLASH_PATTERN);
    if (match) {
      const parsed = new Date(match[1]);
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
