import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { setSetting } from '../src/services/settings.service.js';
import { SecurityGateService } from '../src/services/receipt_verifier/security_gate.service.js';
import { CbeBankAdapter } from '../src/services/receipt_verifier/adapters/cbe.adapter.js';
import { TelebirrAdapter } from '../src/services/receipt_verifier/adapters/telebirr.adapter.js';
import { parseEthiopianBankTimestamp } from '../src/services/receipt_verifier/constants.js';
import type { BankTransactionPayload, ExtractedReceiptReference } from '../src/services/receipt_verifier/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
process.env.ADMIN_IDS = process.env.ADMIN_IDS || '111111111';

const WINDOW = { minutesBefore: 120, minutesAfter: 120 };

function reference(raw: string): ExtractedReceiptReference {
  return {
    bank: 'cbe',
    rawReference: raw,
    normalizedReference: raw.toUpperCase(),
    extractedAt: new Date(),
    confidence: 1,
  };
}

/** A payload identical to a good one except for the transaction timestamp. */
function payloadWithTimestamp(ts: Date | null, overrides: Partial<BankTransactionPayload> = {}): BankTransactionPayload {
  return {
    bank: 'cbe',
    transactionReference: 'FT_RECENT_001',
    amountEtb: 1250,
    feeEtb: 0,
    currency: 'ETB',
    senderName: 'Buyer',
    senderIdentifier: '0911223344',
    beneficiaryAccount: '1000123456789',
    beneficiaryName: 'Bighabesha Shop',
    transactionTimestamp: ts,
    paymentChannel: 'cbe_digital',
    ...overrides,
  };
}

describe('Recency pillar fails closed on an unverifiable timestamp', () => {
  beforeEach(() => {
    initDatabase(':memory:', migrationsDir);
    setSetting('receipt_cbe_beneficiaries', JSON.stringify(['1000123456789']));
    setSetting('cbe_account', '1000123456789');
  });

  afterEach(() => {
    closeDatabase();
  });

  // ==========================================================================
  // The regression: "unknown timestamp" must never be read as "timestamp is now"
  // ==========================================================================

  it('rejects a null transaction timestamp instead of treating it as "now"', () => {
    const gate = new SecurityGateService();
    const orderCreated = new Date();

    expect(gate.assertRecency(orderCreated, null, WINDOW)).toBe(false);
  });

  it('rejects an Invalid Date object', () => {
    const gate = new SecurityGateService();
    expect(gate.assertRecency(new Date(), new Date('not-a-date'), WINDOW)).toBe(false);
  });

  it('parseEthiopianBankTimestamp returns null rather than "now" for unparseable input', () => {
    // The original defect lived here: every failure path returned new Date(), so the
    // recency gate could never tell "unknown" from "just now".
    expect(parseEthiopianBankTimestamp(null)).toBeNull();
    expect(parseEthiopianBankTimestamp(undefined)).toBeNull();
    expect(parseEthiopianBankTimestamp('')).toBeNull();
    expect(parseEthiopianBankTimestamp('   ')).toBeNull();
    expect(parseEthiopianBankTimestamp(new Date('nope'))).toBeNull();
    expect(parseEthiopianBankTimestamp('gibberish-no-date-here')).toBeNull();

    // Genuine dates must still parse.
    expect(parseEthiopianBankTimestamp('2026-09-16 12:25:00')).toBeInstanceOf(Date);
    expect(parseEthiopianBankTimestamp('16/09/2026 12:25:00')).toBeInstanceOf(Date);
  });

  it('still accepts a genuine in-window timestamp (no over-blocking)', () => {
    const gate = new SecurityGateService();
    const orderCreated = new Date();
    const tx = new Date(orderCreated.getTime() - 30 * 60_000);

    expect(gate.assertRecency(orderCreated, tx, WINDOW)).toBe(true);
  });

  it('still rejects a genuinely stale timestamp', () => {
    const gate = new SecurityGateService();
    const orderCreated = new Date();
    const stale = new Date(orderCreated.getTime() - 10 * 24 * 60 * 60_000);

    expect(gate.assertRecency(orderCreated, stale, WINDOW)).toBe(false);
  });

  // ==========================================================================
  // End-to-end pillar behaviour through evaluate()
  // ==========================================================================

  it('fails the recency_window pillar and blocks fulfillment when the date is unreadable', async () => {
    const gate = new SecurityGateService();
    const now = new Date();

    const result = await gate.evaluate(
      {
        orderId: 'ORD-NO-TIMESTAMP',
        userId: 1001,
        netPayableEtb: 1250,
        paymentRail: 'cbe',
        orderCreatedAt: now,
      },
      payloadWithTimestamp(null)
    );

    expect(result.passed).toBe(false);
    expect(result.failedPillar?.pillar).toBe('recency_window');

    const recency = result.evaluations.find((e) => e.pillar === 'recency_window')!;
    expect(recency.passed).toBe(false);
    // Diagnostics must not render a NaN delta.
    expect(recency.actual).toContain('unavailable');
    expect(recency.actual).not.toContain('NaN');
    expect(recency.details).toContain('no readable transaction timestamp');
  });

  it('passes all four pillars when the timestamp is present and in window', async () => {
    const gate = new SecurityGateService();
    const now = new Date();
    const tx = new Date(now.getTime() - 10 * 60_000);

    const result = await gate.evaluate(
      {
        orderId: 'ORD-GOOD-TIMESTAMP',
        userId: 1001,
        netPayableEtb: 1250,
        paymentRail: 'cbe',
        orderCreatedAt: now,
      },
      payloadWithTimestamp(tx)
    );

    expect(result.failedPillar).toBeUndefined();
    expect(result.passed).toBe(true);
  });

  // ==========================================================================
  // Adapters must propagate `null`, never substitute `new Date()`
  // ==========================================================================

  it('returns a null timestamp from the CBE adapter when the slip has no date', () => {
    const adapter = new CbeBankAdapter();
    const html = `
      <html><body>
        <table><tr><th>Amount</th><td>1,250.00</td></tr>
        <tr><th>Reference</th><td>FT_NO_DATE_001</td></tr>
        <tr><th>Credited Account</th><td>1000123456789</td></tr></table>
        <p>No date appears anywhere in this document.</p>
      </body></html>
    `;

    const parsed = adapter.parseHtmlResponse(html, reference('FT_NO_DATE_001'));
    expect(parsed.transactionTimestamp).toBeNull();
  });

  it('returns a null timestamp from the Telebirr adapter when the receipt has no date', () => {
    const adapter = new TelebirrAdapter();
    const html = `
      <html><body>
        <table><tr><th>Amount</th><td>1,250.00</td></tr>
        <tr><th>Receipt Number</th><td>FT_TB_NO_DATE_001</td></tr></table>
        <p>No date appears anywhere in this document.</p>
      </body></html>
    `;

    const parsed = adapter.parseHtmlResponse(html, reference('FT_TB_NO_DATE_001'));
    expect(parsed.transactionTimestamp).toBeNull();
  });

  it('returns a null timestamp when a date is present but not a real calendar date', () => {
    // This is the case the old `!isNaN(parsed.getTime())` guard silently missed:
    // the date pattern matched, the parser ran, and the parser returned "now".
    const cbe = new CbeBankAdapter().parseHtmlResponse(
      `<html><body><p>Date: 2026-13-45 99:99:99</p><p>Reference: FT_BAD_DATE</p></body></html>`,
      reference('FT_BAD_DATE')
    );
    expect(cbe.transactionTimestamp).toBeNull();

    const telebirr = new TelebirrAdapter().parseHtmlResponse(
      `<html><body><p>Date: 2026-13-45 99:99:99</p><p>Receipt Number: FT_TB_BAD_DATE</p></body></html>`,
      reference('FT_TB_BAD_DATE')
    );
    expect(telebirr.transactionTimestamp).toBeNull();
  });

  it('still parses a real timestamp on both adapters', () => {
    const iso = new Date().toISOString();

    const cbe = new CbeBankAdapter().parseHtmlResponse(
      `<html><body><p>Date: ${iso}</p><p>Reference: FT_WITH_DATE</p></body></html>`,
      reference('FT_WITH_DATE')
    );
    expect(cbe.transactionTimestamp).not.toBeNull();
    expect(isNaN(cbe.transactionTimestamp!.getTime())).toBe(false);

    const telebirr = new TelebirrAdapter().parseHtmlResponse(
      `<html><body><p>Date: ${iso}</p><p>Receipt Number: FT_TB_WITH_DATE</p></body></html>`,
      reference('FT_TB_WITH_DATE')
    );
    expect(telebirr.transactionTimestamp).not.toBeNull();
    expect(isNaN(telebirr.transactionTimestamp!.getTime())).toBe(false);
  });
});
