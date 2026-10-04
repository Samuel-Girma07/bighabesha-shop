import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { TelebirrAdapter } from '../src/services/receipt_verifier/adapters/telebirr.adapter.js';
import { SecurityGateService } from '../src/services/receipt_verifier/security_gate.service.js';
import { parseEthiopianBankTimestamp } from '../src/services/receipt_verifier/constants.js';
import { UnconfirmedTransactionError } from '../src/services/receipt_verifier/types.js';
import { setSetting } from '../src/services/settings.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'telebirr-receipt-synthetic.html'),
  'utf8'
);

const FIXTURE_REF = 'FT26TESTREF001';
/** Visible digits of the fixture's masked credited-party account. */
const FIXTURE_MASKED_ACCOUNT = '2599****0000';

function ref(normalizedReference = FIXTURE_REF) {
  return {
    bank: 'telebirr' as const,
    rawReference: normalizedReference,
    normalizedReference,
    extractedAt: new Date(),
    confidence: 0.9,
    source: 'text' as const,
  };
}

/**
 * Regression cover for the Telebirr parser rewrite.
 *
 * The previous parser was written against a guessed layout and matched none of
 * the real markup:
 *   - it paired the FIRST cell of a row with the LAST cell of the SAME row, so
 *     on the real header-row/value-row shape every lookup missed;
 *   - it looked for 'credited party' and 'total amount', neither of which
 *     appears on the real page;
 *   - it expected a DD/MM/YYYY or ISO date, while the portal renders DD-MM-YYYY;
 *   - it stripped masking from accounts, so a masked credited party could never
 *     equal a configured whitelist entry;
 *   - it fell back to the CUSTOMER-supplied reference and amount when parsing
 *     failed, so any well-formed page could stand in for a real payment.
 *
 * Driven by a synthetic fixture that mirrors the observed structure. No real
 * payer data, account fragment or reference is committed.
 */
describe('Telebirr parser: real-markup structure', () => {
  const adapter = new TelebirrAdapter();

  describe('DD-MM-YYYY date parsing (fix 1)', () => {
    it('parses the day-first dashed format the portal actually renders', () => {
      const parsed = parseEthiopianBankTimestamp('04-10-2026 09:15:00');
      expect(parsed).not.toBeNull();
      // Day-first: 4 October, NOT 10 April.
      expect(parsed?.toISOString()).toBe('2026-10-04T06:15:00.000Z');
    });

    it('does not reinterpret a dashed date as month-first', () => {
      // The bug this fixes: the trailing "-2026" matched the explicit-offset
      // shortcut, so "04-10-2026" reached new Date() and V8 read it as April 10.
      const parsed = parseEthiopianBankTimestamp('04-10-2026');
      // October, not April. The UTC *day* is the 3rd because midnight at +03:00
      // is 21:00 UTC the previous evening, which is correct, not a defect.
      expect(parsed?.getUTCMonth()).toBe(9);
      expect(parsed?.getUTCFullYear()).toBe(2026);
    });

    it('still parses ISO and slash formats unchanged', () => {
      expect(parseEthiopianBankTimestamp('2026-10-04T09:15:00Z')?.toISOString())
        .toBe('2026-10-04T09:15:00.000Z');
      expect(parseEthiopianBankTimestamp('04/10/2026 09:15:00')?.toISOString())
        .toBe('2026-10-04T06:15:00.000Z');
    });

    it('still returns null for garbage', () => {
      expect(parseEthiopianBankTimestamp('nonsense')).toBeNull();
    });
  });

  describe('label/value pairing (the core defect)', () => {
    it('pairs header-row labels with the value row beneath them', () => {
      const payload = adapter.parseHtmlResponse(FIXTURE, ref());
      // Read from the invoice row: if labels were paired within their own row,
      // this would resolve to the label text instead of the reference.
      expect(payload.transactionReference).toBe(FIXTURE_REF);
    });

    it('extracts the credited party name from the bilingual label', () => {
      const payload = adapter.parseHtmlResponse(FIXTURE, ref());
      expect(payload.beneficiaryName).toBe('TEST BENEFICIARY NAME');
    });

    it('extracts the masked credited-party account without destroying the mask', () => {
      const payload = adapter.parseHtmlResponse(FIXTURE, ref());
      expect(payload.beneficiaryAccount).toBe(FIXTURE_MASKED_ACCOUNT);
    });

    it('extracts the payment date from the Payment date column', () => {
      const payload = adapter.parseHtmlResponse(FIXTURE, ref());
      expect(payload.transactionTimestamp).not.toBeNull();
      // Fixture payment date is 17-06-2025 (day-first, dashes). Day-first
      // parsing is the whole point: month-first would yield 17 December.
      expect(payload.transactionTimestamp?.getUTCDate()).toBe(17);
      expect(payload.transactionTimestamp?.getUTCMonth()).toBe(5);
    });

    it('reads the transaction status out of the single-cell row', () => {
      const payload = adapter.parseHtmlResponse(FIXTURE, ref());
      expect(payload.transactionStatus).toBe('completed');
    });
  });

  describe('settled amount, not total (fix 2 / F19)', () => {
    it('uses Settled Amount and never Total Paid Amount', () => {
      const payload = adapter.parseHtmlResponse(FIXTURE, ref());
      // Fixture: Settled 1,000.00 / Service fee 54 / VAT 6 / Total 1,060.00.
      expect(payload.amountEtb).toBe(1000);
      expect(payload.amountEtb).not.toBe(1060);
    });

    it('never picks up the account balance', () => {
      const payload = adapter.parseHtmlResponse(FIXTURE, ref());
      expect(payload.amountEtb).not.toBe(48760);
    });
  });

  describe('F1 reference binding', () => {
    it('rejects a page describing a different transaction', () => {
      expect(() => adapter.parseHtmlResponse(FIXTURE, ref('FT26SOMEONEELSE')))
        .toThrow(UnconfirmedTransactionError);
    });

    it('does not adopt the customer-supplied reference when the page has none', () => {
      // A page with no invoice number and no status must not be paired with the
      // reference the customer typed in.
      const noProof = '<html><body><table><tr><td>Nothing useful</td><td>x</td></tr></table></body></html>';
      expect(() => adapter.parseHtmlResponse(noProof, ref())).toThrow(UnconfirmedTransactionError);
    });

    it('rejects a page with no transaction status', () => {
      const noStatus = FIXTURE.replace(/transaction status Completed/g, 'some other text');
      expect(() => adapter.parseHtmlResponse(noStatus, ref())).toThrow(UnconfirmedTransactionError);
    });
  });

  describe('beneficiary whitelist with masked accounts (fix 3 / F12)', () => {
    const gate = new SecurityGateService();

    beforeEach(() => {
      initDatabase(':memory:', migrationsDir);
    });

    afterEach(() => {
      closeDatabase();
    });

    it('matches a masked receipt account against a masked whitelist entry', () => {
      setSetting('receipt_telebirr_beneficiaries', JSON.stringify([FIXTURE_MASKED_ACCOUNT]));
      expect(gate.assertBeneficiary('telebirr', FIXTURE_MASKED_ACCOUNT)).toBe(true);
    });

    it('rejects a masked account whose visible digits differ', () => {
      setSetting('receipt_telebirr_beneficiaries', JSON.stringify(['2599****9999']));
      expect(gate.assertBeneficiary('telebirr', FIXTURE_MASKED_ACCOUNT)).toBe(false);
    });

    it('rejects an empty account', () => {
      setSetting('receipt_telebirr_beneficiaries', JSON.stringify([FIXTURE_MASKED_ACCOUNT]));
      expect(gate.assertBeneficiary('telebirr', '')).toBe(false);
    });

    it('rejects an account that is too short to be meaningful', () => {
      setSetting('receipt_telebirr_beneficiaries', JSON.stringify([FIXTURE_MASKED_ACCOUNT]));
      expect(gate.assertBeneficiary('telebirr', '12**34')).toBe(false);
    });

    it('still matches unmasked accounts exactly', () => {
      setSetting('receipt_telebirr_beneficiaries', JSON.stringify(['0912345678']));
      expect(gate.assertBeneficiary('telebirr', '0912345678')).toBe(true);
      expect(gate.assertBeneficiary('telebirr', '0912345679')).toBe(false);
    });

    it('will not let a short masked pattern match a longer account', () => {
      setSetting('receipt_telebirr_beneficiaries', JSON.stringify(['2599****']));
      expect(gate.assertBeneficiary('telebirr', FIXTURE_MASKED_ACCOUNT)).toBe(false);
    });
  });
});
