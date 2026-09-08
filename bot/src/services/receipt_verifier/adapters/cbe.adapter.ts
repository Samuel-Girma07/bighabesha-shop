import * as cheerio from 'cheerio';
import { logger } from '../../../logger/index.js';
import { CircuitBreaker } from '../circuit_breaker.js';
import { BaseBankAdapter } from './base.adapter.js';
import {
  CBE_PERMITTED_HOSTNAMES,
  DEFAULT_BANK_NETWORK_TIMEOUT_MS,
} from '../constants.js';
import {
  SupportedBank,
  ExtractedReceiptReference,
  BankTransactionPayload,
  BankVerificationOptions,
} from '../types.js';

// ============================================================================
// Statically Instantiated Regular Expressions
// ============================================================================

const CBE_FT_REF_PATTERN = /^FT[0-9A-Z]{8,16}$/i;
const CBE_HOST_PATTERN = /apps\.cbe\.com\.et/i;

const CBE_TX_REF_PATTERN_1 = /(?:transaction\s*reference|reference|ref\.?)\s*[:=\s]\s*([A-Za-z0-9_\-]+)/i;
const CBE_TX_REF_PATTERN_2 = /\b(FT[0-9A-Z_\-]{6,24})\b/i;

const CBE_AMOUNT_PATTERN_1 = /(?:transferred|amount|paid|total|etb)\s*[:=]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i;
const CBE_AMOUNT_PATTERN_2 = /([0-9,]+(?:\.[0-9]{1,2})?)\s*ETB/i;

const CBE_BEN_ACC_PATTERN_1 = /(?:credited\s*account|receiver\s*account|beneficiary\s*account|to\s*account)\s*[:=]?\s*([0-9]{10,16})/i;
const CBE_BEN_ACC_PATTERN_2 = /\b(1000[0-9]{9})\b/;
const CBE_BEN_NAME_PATTERN = /(?:credited\s*to|receiver(?:\s*name)?|beneficiary(?:\s*name)?)\s*[:=]?\s*([^\r\n;0-9:]{1,80}?)(?:\r?\n|$|;|\baccount\b)/i;

const CBE_SENDER_NAME_PATTERN = /(?:debited\s*from|payer(?:\s*name)?|sender(?:\s*name)?)\s*[:=]?\s*([^\r\n;0-9:]{1,80}?)(?:\r?\n|$|;|\baccount\b)/i;
const CBE_SENDER_ACC_PATTERN = /(?:debited\s*account|payer\s*account|from\s*account)\s*[:=]?\s*([0-9*]{8,16})/i;

const CBE_DATE_ISO_PATTERN = /([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[\sT][0-9]{2}:[0-9]{2}:[0-9]{2})?)/;
const CBE_DATE_SLASH_PATTERN = /([0-9]{2}\/[0-9]{2}\/[0-9]{4}(?:[\sT][0-9]{2}:[0-9]{2}:[0-9]{2})?)/;

const PDF_HEADER_MAGIC = '%PDF-';

/**
 * Commercial Bank of Ethiopia (CBE) Verification Adapter.
 * Queries CBE confirmation portal (Port 100 / Web) and extracts verified slip details.
 */
export class CbeBankAdapter extends BaseBankAdapter {
  public readonly bankRail: SupportedBank = 'cbe';

  constructor(circuitBreaker?: CircuitBreaker) {
    super(
      circuitBreaker || new CircuitBreaker({ name: 'cbe_adapter', failureThreshold: 3, cooldownMs: 60_000 }),
      DEFAULT_BANK_NETWORK_TIMEOUT_MS
    );
  }

  public canHandle(reference: ExtractedReceiptReference): boolean {
    if (reference.bank === 'cbe') return true;
    if (CBE_FT_REF_PATTERN.test(reference.normalizedReference)) return true;
    if (reference.sourceUrl && CBE_HOST_PATTERN.test(reference.sourceUrl)) return true;
    return false;
  }

  public async verify(
    reference: ExtractedReceiptReference,
    options?: BankVerificationOptions
  ): Promise<BankTransactionPayload> {
    const bypassCb = options?.bypassCircuitBreaker === true;
    this.ensureCircuitBreakerPermits(bypassCb);

    const allowedPorts = this.getAllowedPorts();
    const targetUrl = this.buildVerificationUrl(reference, options);
    await this.validateSsrfHost(targetUrl, CBE_PERMITTED_HOSTNAMES, allowedPorts);

    const timeoutMs = options?.timeoutMs || this.defaultTimeoutMs;
    const startTime = Date.now();

    return this.executeWithProtection({
      targetUrl,
      timeoutMs,
      operation: async (signal) => {
        logger.info({ targetUrl, ref: reference.normalizedReference }, 'Querying upstream CBE portal');

        const response = await fetch(targetUrl, {
          signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
            Accept: 'text/html,application/pdf,application/xhtml+xml,*/*',
          },
        });

        if (!response.ok) {
          throw new Error(`Upstream CBE responded with HTTP ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const buffer = Buffer.from(await response.arrayBuffer());

        let payload: BankTransactionPayload;
        if (contentType.includes('pdf') || buffer.subarray(0, 5).toString('ascii').startsWith(PDF_HEADER_MAGIC)) {
          payload = await this.parsePdfResponse(buffer, reference);
        } else {
          const html = buffer.toString('utf-8');
          payload = this.parseHtmlResponse(html, reference);
        }

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

  private getAllowedPorts(): number[] {
    const defaultPorts = [443, 100];
    if (process.env.RECEIPT_CBE_PORT) {
      const parsed = parseInt(process.env.RECEIPT_CBE_PORT.trim(), 10);
      if (!isNaN(parsed) && parsed > 0 && !defaultPorts.includes(parsed)) {
        defaultPorts.push(parsed);
      }
    }
    return defaultPorts;
  }

  private buildVerificationUrl(
    reference: ExtractedReceiptReference,
    options?: BankVerificationOptions
  ): string {
    const allowedPorts = this.getAllowedPorts();
    if (reference.sourceUrl) {
      this.assertSsrfSafety(reference.sourceUrl, CBE_PERMITTED_HOSTNAMES, allowedPorts);
      return reference.sourceUrl;
    }

    const ref = reference.normalizedReference;
    let port = ':100';
    if (options?.forcePort100 === false) {
      port = '';
    } else if (process.env.RECEIPT_CBE_PORT) {
      const p = process.env.RECEIPT_CBE_PORT.trim();
      port = (p === '443' || p === '') ? '' : `:${p}`;
    }
    return `https://apps.cbe.com.et${port}/?id=${encodeURIComponent(ref)}`;
  }

  // ============================================================================
  // Response Parsing (PDF & HTML)
  // ============================================================================

  public async parsePdfResponse(
    pdfBuffer: Buffer,
    reference: ExtractedReceiptReference
  ): Promise<BankTransactionPayload> {
    let text = '';
    try {
      const pdfModule = await import('pdf-parse');
      const PDFParse = (pdfModule as Record<string, unknown>).PDFParse ||
        (pdfModule as Record<string, unknown>).default ||
        pdfModule;

      if (typeof PDFParse === 'function') {
        try {
          const parser = new (PDFParse as any)({ data: pdfBuffer });
          if (typeof parser.load === 'function') {
            await parser.load();
            const res = await parser.getText();
            text = typeof res === 'string' ? res : (res?.text || '');
          } else {
            const res = await (PDFParse as Function)(pdfBuffer);
            text = res?.text || '';
          }
        } catch {
          const res = await (PDFParse as Function)(pdfBuffer);
          text = res?.text || '';
        }
      }
    } catch {
      text = pdfBuffer.toString('latin1');
    }

    return this.extractPayloadFromText(text, reference, { source: 'vector_pdf' });
  }

  public parseHtmlResponse(
    html: string,
    reference: ExtractedReceiptReference
  ): BankTransactionPayload {
    const $ = cheerio.load(html);
    const text = $('body').text() || html;
    return this.extractPayloadFromText(text, reference, { source: 'html_dom', title: $('title').text() });
  }

  private extractPayloadFromText(
    text: string,
    reference: ExtractedReceiptReference,
    extraAudit: Record<string, unknown>
  ): BankTransactionPayload {
    const txRef = this.extractReference(text, reference.normalizedReference);
    const amountEtb = this.extractAmount(text, reference.amountEtb);
    const beneficiary = this.extractBeneficiary(text);
    const sender = this.extractSender(text);
    const transactionTimestamp = this.extractTimestamp(text);

    return {
      bank: 'cbe',
      transactionReference: txRef,
      amountEtb,
      feeEtb: 0,
      currency: 'ETB',
      senderName: sender.name,
      senderIdentifier: sender.identifier,
      beneficiaryAccount: beneficiary.account,
      beneficiaryName: beneficiary.name,
      transactionTimestamp,
      paymentChannel: 'cbe_digital',
      rawAuditTrail: {
        ...extraAudit,
        parsedAt: new Date().toISOString(),
      },
    };
  }

  // ============================================================================
  // Field Extractors (SRP Decomposition)
  // ============================================================================

  private extractReference(text: string, fallbackRef: string): string {
    const match = text.match(CBE_TX_REF_PATTERN_1) || text.match(CBE_TX_REF_PATTERN_2);
    return match ? match[1].toUpperCase() : fallbackRef;
  }

  private extractAmount(text: string, fallbackAmount?: number): number {
    const match = text.match(CBE_AMOUNT_PATTERN_1) || text.match(CBE_AMOUNT_PATTERN_2);
    if (match) {
      const parsed = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return fallbackAmount || 0;
  }

  private extractBeneficiary(text: string): { account: string; name: string } {
    const accMatch = text.match(CBE_BEN_ACC_PATTERN_1) || text.match(CBE_BEN_ACC_PATTERN_2);
    const account = accMatch ? accMatch[1] : '';

    const nameMatch = text.match(CBE_BEN_NAME_PATTERN);
    const name = nameMatch ? nameMatch[1].trim() : 'Bighabesha Shop';

    return { account, name };
  }

  private extractSender(text: string): { name?: string; identifier?: string } {
    const nameMatch = text.match(CBE_SENDER_NAME_PATTERN);
    const name = nameMatch ? nameMatch[1].trim() : undefined;

    const accMatch = text.match(CBE_SENDER_ACC_PATTERN);
    const identifier = accMatch ? accMatch[1] : undefined;

    return { name, identifier };
  }

  private extractTimestamp(text: string): Date {
    const dateMatch = text.match(CBE_DATE_ISO_PATTERN) || text.match(CBE_DATE_SLASH_PATTERN);
    if (dateMatch) {
      const parsed = new Date(dateMatch[1]);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return new Date();
  }
}
