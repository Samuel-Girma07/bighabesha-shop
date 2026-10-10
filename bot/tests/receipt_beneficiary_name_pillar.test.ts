/**
 * Credited-party NAME pillar (optional fifth security pillar).
 *
 * The beneficiary whitelist compares the credited ACCOUNT only, and every mobile
 * rail masks that account (`NNNN****NNNN`), so a whitelist hit proves just a few
 * visible digits. The bank portal also publishes the credited-party NAME in
 * cleartext, which is a far stronger signal — this suite covers the matching
 * mechanism and its opt-in behaviour.
 *
 * The expected name SHIPS UNSET on purpose: no inbound customer -> shop payment
 * has been captured yet, so the value Telebirr renders for this shop's receiving
 * account is still unknown. An unset value must leave the engine untouched.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { setSetting } from '../src/services/settings.service.js';
import { logger } from '../src/logger/index.js';
import { SecurityGateService } from '../src/services/receipt_verifier/security_gate.service.js';
import { beneficiaryNameMatches, normalizeNameTokens } from '../src/services/receipt_verifier/constants.js';
import type { BankTransactionPayload, OrderSecurityContext } from '../src/services/receipt_verifier/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
process.env.ADMIN_IDS = process.env.ADMIN_IDS || '111111111';

/** Masked Telebirr rendering: exactly the 12 visible characters the portal emits. */
const MASKED_ACCOUNT = '0911****3344';

/** Placeholder merchant name, NOT a captured portal value. */
const EXPECTED_NAME = 'Bighabesha Shop';

function orderContext(orderId: string): OrderSecurityContext {
  return {
    orderId,
    userId: 1001,
    netPayableEtb: 1250,
    paymentRail: 'telebirr',
    orderCreatedAt: new Date(),
  };
}

function telebirrPayload(overrides: Partial<BankTransactionPayload> = {}): BankTransactionPayload {
  const now = new Date();
  return {
    bank: 'telebirr',
    transactionReference: `FT${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
    amountEtb: 1250,
    feeEtb: 0,
    currency: 'ETB',
    senderName: 'Buyer',
    senderIdentifier: '0911776655',
    beneficiaryAccount: MASKED_ACCOUNT,
    beneficiaryName: EXPECTED_NAME,
    transactionTimestamp: new Date(now.getTime() - 5 * 60_000),
    paymentChannel: 'telebirr',
    ...overrides,
  };
}

describe('Beneficiary name normalization', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeNameTokens('  BIGHABESHA   Shop,  PLC.  ')).toEqual(['bighabesha', 'shop', 'plc']);
    expect(normalizeNameTokens('bighabesha-shop-plc')).toEqual(['bighabesha', 'shop', 'plc']);
    expect(normalizeNameTokens('Bighabesha  Shop & Trading')).toEqual(['bighabesha', 'shop', 'trading']);
  });

  it('strips Latin diacritics but leaves Ethiopic script intact', () => {
    expect(normalizeNameTokens('Bíghabésha Shóp')).toEqual(['bighabesha', 'shop']);
    expect(normalizeNameTokens('ቢግሃበሻ የሱብር')).toEqual(['ቢግሃበሻ', 'የሱብር']);
  });

  it('returns an empty token list for missing input', () => {
    expect(normalizeNameTokens('')).toEqual([]);
    expect(normalizeNameTokens('   ')).toEqual([]);
    expect(normalizeNameTokens(null)).toEqual([]);
    expect(normalizeNameTokens(undefined)).toEqual([]);
  });
});

describe('Beneficiary name matching', () => {
  it('ignores casing, punctuation and spacing', () => {
    expect(beneficiaryNameMatches(EXPECTED_NAME, 'bighabesha shop')).toBe(true);
    expect(beneficiaryNameMatches(EXPECTED_NAME, 'BIGHABESHA   SHOP')).toBe(true);
    expect(beneficiaryNameMatches(EXPECTED_NAME, 'Bighabesha-Shop,')).toBe(true);
  });

  it('accepts a legal suffix on either side (subset matching)', () => {
    expect(beneficiaryNameMatches(EXPECTED_NAME, 'Bighabesha Shop PLC')).toBe(true);
    expect(beneficiaryNameMatches('Bighabesha Shop PLC', EXPECTED_NAME)).toBe(true);
    expect(beneficiaryNameMatches(EXPECTED_NAME, 'Bighabesha Shop PLC Trading Company')).toBe(true);
  });

  it('accepts token order swapped', () => {
    expect(beneficiaryNameMatches('Shop Bighabesha', 'Bighabesha Shop')).toBe(true);
  });

  it('tolerates minor transliteration drift on long tokens', () => {
    // Invented token pair, not a real payer's name — see the note in
    // `constants.ts`. Both assertions keep the property they were written for:
    // a one-letter doubling inside a 9-10 character token is absorbed, and the
    // tokens still match when the portal renders them in the opposite order.
    expect(beneficiaryNameMatches('Xobentossa Shop', 'Xobentosa Shop')).toBe(true);
    expect(beneficiaryNameMatches('Xobentosa Xobentossa', 'Xobentossa Xobentosa')).toBe(true);
  });

  it('rejects a name belonging to somebody else', () => {
    expect(beneficiaryNameMatches(EXPECTED_NAME, 'Abebe Kebede')).toBe(false);
    expect(beneficiaryNameMatches(EXPECTED_NAME, 'Bighabesha Trading')).toBe(false);
    expect(beneficiaryNameMatches('Telebirr Payments', 'Telebirr Payments')).toBe(true);
  });

  it('never matches when either side is empty (absence of evidence is not a pass)', () => {
    expect(beneficiaryNameMatches('', EXPECTED_NAME)).toBe(false);
    expect(beneficiaryNameMatches(EXPECTED_NAME, '')).toBe(false);
    expect(beneficiaryNameMatches(EXPECTED_NAME, null)).toBe(false);
    expect(beneficiaryNameMatches(null, null)).toBe(false);
  });

  /**
   * Pins the spelling-drift budget on both sides of the boundary.
   *
   * Scrubbing the real payer's name out of this file must not quietly move the
   * threshold: `toleratedEditDistance` allows 2 edits at 8+ characters and 1 at
   * 4-7, so the tolerance is only a safety net for transcription noise if
   * anything past that budget still fails. Both token pairs below are invented.
   */
  it('absorbs drift inside the budget and rejects drift past it', () => {
    // Long tokens, budget 2: one dropped letter (edit distance 1) is absorbed.
    expect(beneficiaryNameMatches('Xobentossa Shop', 'Xobentosa Shop')).toBe(true);
    // Long tokens, budget 2: a different word of the same length (edit distance
    // 4) still fails, so the budget is a transcription net, not a fuzzy match.
    expect(beneficiaryNameMatches('Xobentossa Shop', 'Qobetnassa Shop')).toBe(false);

    // 4-character tokens, budget 1: a single dropped letter is absorbed.
    expect(beneficiaryNameMatches('Xobe Shop', 'Xob Shop')).toBe(true);
    // 3-character tokens, budget 0: one substitution is a different name.
    expect(beneficiaryNameMatches('Xob Shop', 'Xoe Shop')).toBe(false);
  });
});

describe('Beneficiary name pillar enforcement', () => {
  beforeEach(() => {
    initDatabase(':memory:', migrationsDir);
    // Masked whitelist — the account pillar is satisfied by construction.
    setSetting('receipt_telebirr_beneficiaries', JSON.stringify([MASKED_ACCOUNT]));
    setSetting('telebirr_account', MASKED_ACCOUNT);
    setSetting('receipt_cbe_beneficiaries', JSON.stringify(['1000123456789']));
    setSetting('cbe_account', '1000123456789');
  });

  afterEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
  });

  it('stays dormant and leaves the account pillar in charge, warning about it exactly once', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation((() => {}) as never);
    const gate = new SecurityGateService();

    const result = await gate.evaluate(orderContext('ORD-NAME-UNSET'), telebirrPayload());

    // Unconfigured must not add a pillar and must not fail the order.
    expect(result.evaluations).toHaveLength(4);
    expect(result.evaluations.some((e) => e.pillar === 'beneficiary_name')).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.failedPillar).toBeUndefined();

    // ...but the operator is told the pillar is doing nothing — once, not once
    // per submission, since a busy review queue would otherwise flood the log.
    const nameWarnings = () =>
      warnSpy.mock.calls.filter((c) => String(c[1]).includes('Beneficiary name pillar'));

    expect(nameWarnings()).toHaveLength(1);
    expect(nameWarnings()[0][0]).toMatchObject({
      settingKey: 'receipt_telebirr_expected_name',
      bank: 'telebirr',
    });

    await gate.evaluate(orderContext('ORD-NAME-UNSET-2'), telebirrPayload());
    await gate.evaluate(orderContext('ORD-NAME-UNSET-3'), telebirrPayload());
    expect(nameWarnings()).toHaveLength(1);
  });

  it('still fails on the masked account alone when the name pillar is unconfigured', async () => {
    const result = await new SecurityGateService().evaluate(
      orderContext('ORD-NAME-ACCOUNT-ONLY'),
      telebirrPayload({ beneficiaryAccount: '0999****0000' })
    );

    expect(result.failedPillar?.pillar).toBe('beneficiary_whitelist');
    expect(result.evaluations.some((e) => e.pillar === 'beneficiary_name')).toBe(false);
  });

  it('passes and is recorded in the audit trail when the name matches', async () => {
    setSetting('receipt_telebirr_expected_name', EXPECTED_NAME);

    const result = await new SecurityGateService().evaluate(
      orderContext('ORD-NAME-MATCH'),
      telebirrPayload({ beneficiaryName: 'BIGHABESHA SHOP PLC' })
    );

    const pillar = result.evaluations.find((e) => e.pillar === 'beneficiary_name')!;
    expect(pillar).toBeDefined();
    expect(pillar.passed).toBe(true);
    expect(pillar.expected).toBe(EXPECTED_NAME);
    expect(pillar.actual).toBe('BIGHABESHA SHOP PLC');
    expect(result.evaluations).toHaveLength(5);
    expect(result.passed).toBe(true);
  });

  it('fails when the credited name belongs to a different party, even though the account matches', async () => {
    setSetting('receipt_telebirr_expected_name', EXPECTED_NAME);

    const result = await new SecurityGateService().evaluate(
      orderContext('ORD-NAME-MISMATCH'),
      telebirrPayload({ beneficiaryName: 'Abebe Kebede' })
    );

    // The masked account still hits the whitelist — that is exactly why the name
    // pillar is needed.
    expect(result.evaluations.find((e) => e.pillar === 'beneficiary_whitelist')!.passed).toBe(true);

    const pillar = result.evaluations.find((e) => e.pillar === 'beneficiary_name')!;
    expect(pillar.passed).toBe(false);
    expect(pillar.actual).toBe('Abebe Kebede');
    expect(pillar.details).toContain('does not match');
    expect(result.passed).toBe(false);
    expect(result.failedPillar?.pillar).toBe('beneficiary_name');
  });

  it('fails when the portal rendered no credited-party name at all', async () => {
    setSetting('receipt_telebirr_expected_name', EXPECTED_NAME);

    const result = await new SecurityGateService().evaluate(
      orderContext('ORD-NAME-MISSING'),
      telebirrPayload({ beneficiaryName: '' })
    );

    const pillar = result.evaluations.find((e) => e.pillar === 'beneficiary_name')!;
    expect(pillar.passed).toBe(false);
    expect(pillar.actual).toBe('UNKNOWN');
    expect(result.failedPillar?.pillar).toBe('beneficiary_name');
  });

  it('is never enforced for CBE while the bank-rendered credited-party name is unknown', async () => {
    setSetting('receipt_cbe_expected_name', 'A Name No Receipt Will Ever Match');

    const result = await new SecurityGateService().evaluate(
      { ...orderContext('ORD-NAME-CBE'), paymentRail: 'cbe' },
      {
        ...telebirrPayload({
          bank: 'cbe',
          beneficiaryAccount: '1000123456789',
          beneficiaryName: 'Bighabesha Shop',
        }),
      }
    );

    // Excluded because no inbound customer -> shop CBE payment has been
    // captured, so the name the bank renders for this receiving account is
    // still unverified. See `NAME_PILLAR_ENFORCED_RAILS`. The adapter no longer
    // fabricates this value, so the OLD reason no longer applies — it is a
    // missing observation now, not a known-bad one.
    expect(result.evaluations.some((e) => e.pillar === 'beneficiary_name')).toBe(false);
    expect(result.passed).toBe(true);
  });
});
