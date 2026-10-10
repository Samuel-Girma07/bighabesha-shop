import { checkAntiReplay } from '../../db/receipt_evidence.dao.js';
import { getSetting, getNumericSetting } from '../settings.service.js';
import { logger } from '../../logger/index.js';
import {
  BANK_BENEFICIARY_CONFIG_MAP,
  DEFAULT_RECENCY_BEFORE_MINUTES,
  DEFAULT_RECENCY_AFTER_MINUTES,
  DEFAULT_AMOUNT_TOLERANCE_ETB,
  beneficiaryNameMatches,
  parseEthiopianBankTimestamp,
  parseUtcTimestamp,
} from './constants.js';
import {
  ISecurityGate,
  OrderSecurityContext,
  BankTransactionPayload,
  SecurityGateResult,
  SecurityPillarEvaluation,
  SupportedBank,
  RecencyWindowConfig,
} from './types.js';

const NON_DIGIT_PATTERN = /[^0-9]/g;
const MILLISECONDS_IN_MINUTE = 60_000;

/**
 * Rails whose adapter reports the credited-party name as the portal actually
 * rendered it, so the name pillar compares a real observation.
 *
 * WHY CBE IS ABSENT — the current reason is a MISSING OBSERVATION, not a known
 * bad value. No inbound customer -> shop payment on this shop's CBE account has
 * ever been captured, so the credited-party name the bank actually renders for
 * that account is still unknown. We therefore cannot write
 * `receipt_cbe_expected_name` with any confidence, and enforcing the pillar
 * against a guess would reject genuine receipts over a transliteration
 * difference nobody has yet seen — strictly worse than having no name check on
 * that rail at all.
 *
 * The historical reason is retired, and must not be reintroduced as an
 * explanation: CBE used to be absent because `cbe.adapter.ts` fell back to the
 * literal `'Bighabesha Shop'` whenever its beneficiary-name regex missed, so the
 * check compared a fabricated value against the shop's own name and passed every
 * receipt. That fabricated fallback is gone — the CBE adapter now reports
 * `creditAccountHolder` verbatim, or `''` when the bank sent nothing, which is
 * exactly the honest observation this pillar needs. Code cleanliness is
 * therefore no longer the blocker; the capture is.
 *
 * WHAT WOULD UNBLOCK IT: one live customer -> shop CBE payment, read off the
 * bank's own confirmation (the `creditAccountHolder` field in the transaction
 * detail response, or the name printed on the receipt). Record the name exactly
 * as the bank renders it in `receipt_cbe_expected_name`, add `'cbe'` to this
 * set, and the pillar becomes enforceable on that rail. Both steps are needed:
 * the setting alone leaves the pillar dormant, and the set entry alone would
 * compare against an empty expected name (which `evaluateBeneficiaryNamePillar`
 * treats as unconfigured, not as a failure).
 */
const NAME_PILLAR_ENFORCED_RAILS: ReadonlySet<SupportedBank> = new Set<SupportedBank>(['telebirr']);

/**
 * Settings keys already reported as unconfigured. A busy manual-review queue
 * re-evaluates the gate constantly, and an operator who has not filled the name
 * in yet should get one actionable warning rather than one per submission.
 */
const warnedUnconfiguredNameKeys = new Set<string>();

/**
 * 4-Pillar Security Gate enforcing Anti-Replay, Beneficiary Whitelisting,
 * Exact Amount matching, and Temporal Recency verification.
 */
export class SecurityGateService implements ISecurityGate {
  /**
   * Evaluates all 4 security pillars atomically against the verified bank payload.
   */
  public async evaluate(
    order: OrderSecurityContext,
    bankPayload: BankTransactionPayload
  ): Promise<SecurityGateResult> {
    const evaluations: SecurityPillarEvaluation[] = [
      await this.evaluateAntiReplayPillar(order, bankPayload),
      this.evaluateBeneficiaryPillar(bankPayload),
      this.evaluateAmountPillar(order, bankPayload),
      this.evaluateRecencyPillar(order, bankPayload),
    ];

    // Optional fifth pillar. Appended ONLY when it is actually being enforced,
    // so a dormant check never pads the audit trail with a decorative pass and
    // the admin-facing "4-Pillar Security Evaluation" text stays truthful.
    const beneficiaryNameEvaluation = this.evaluateBeneficiaryNamePillar(bankPayload);
    if (beneficiaryNameEvaluation) evaluations.push(beneficiaryNameEvaluation);

    const allPassed = evaluations.every((e) => e.passed);
    const failedPillar = evaluations.find((e) => !e.passed);

    logger.info(
      { orderId: order.orderId, allPassed, failedPillar: failedPillar?.pillar },
      '4-Pillar Security Gate evaluation completed'
    );

    return {
      passed: allPassed,
      evaluations,
      failedPillar,
      evaluatedAt: new Date(),
    };
  }

  // ============================================================================
  // Individual Pillar Evaluation Builders (SRP Decomposition)
  // ============================================================================

  private async evaluateAntiReplayPillar(
    order: OrderSecurityContext,
    bankPayload: BankTransactionPayload
  ): Promise<SecurityPillarEvaluation> {
    const antiReplay = await this.assertAntiReplay(
      bankPayload.transactionReference,
      order.orderId,
      bankPayload.bank
    );

    return {
      pillar: 'anti_replay',
      passed: antiReplay.passed,
      expected: 'UNIQUE',
      actual: antiReplay.passed ? 'UNIQUE' : `REPLAY (order: ${antiReplay.existingOrderId})`,
      details: antiReplay.passed
        ? `Reference ${bankPayload.transactionReference} is unique.`
        : `Reference ${bankPayload.transactionReference} was already used in order ${antiReplay.existingOrderId}.`,
    };
  }

  private evaluateBeneficiaryPillar(bankPayload: BankTransactionPayload): SecurityPillarEvaluation {
    const passed = this.assertBeneficiary(bankPayload.bank, bankPayload.beneficiaryAccount);
    const approvedList = this.getWhitelistForBank(bankPayload.bank);

    return {
      pillar: 'beneficiary_whitelist',
      passed,
      expected: approvedList.join(', '),
      actual: bankPayload.beneficiaryAccount || 'UNKNOWN',
      details: passed
        ? `Beneficiary account '${bankPayload.beneficiaryAccount}' matches official whitelist.`
        : `Beneficiary account '${bankPayload.beneficiaryAccount}' is not authorized.`,
    };
  }

  /**
   * Optional fifth pillar: compare the credited-party NAME published in
   * cleartext by the bank portal against the operator's expected name for the
   * rail.
   *
   * This exists because the account whitelist is inherently loose on the mobile
   * rails — Telebirr renders the credited account masked (`NNNN****NNNN`), so a
   * whitelist hit proves only the visible digits. The name is not masked, so it
   * is a materially stronger signal and worth asserting independently.
   *
   * Returns `null` — i.e. "pillar not in force" — when the rail is excluded
   * (see `NAME_PILLAR_ENFORCED_RAILS`) or when the expected name is unset. An
   * unset value must never fail an order: the engine has to stay safe to run
   * before the real recipient name has been captured from a live payment, so the
   * masked-account pillar carries the load until an operator opts in.
   */
  private evaluateBeneficiaryNamePillar(
    bankPayload: BankTransactionPayload
  ): SecurityPillarEvaluation | null {
    const bank = bankPayload.bank;
    if (bank === 'unknown' || !NAME_PILLAR_ENFORCED_RAILS.has(bank)) return null;

    const config = BANK_BENEFICIARY_CONFIG_MAP[bank];
    if (!config) return null;

    const settingKey = config.expectedNameSettingKey;
    const expectedName = getSetting(settingKey, '').trim();

    if (!expectedName) {
      if (!warnedUnconfiguredNameKeys.has(settingKey)) {
        warnedUnconfiguredNameKeys.add(settingKey);
        logger.warn(
          { settingKey, bank },
          'Beneficiary name pillar is unconfigured; relying on the masked-account whitelist alone'
        );
      }
      return null;
    }

    const actualName = (bankPayload.beneficiaryName || '').trim();
    const passed = beneficiaryNameMatches(expectedName, actualName);

    return {
      pillar: 'beneficiary_name',
      passed,
      expected: expectedName,
      // A portal that renders no name at all is `UNKNOWN`, not a pass: absence
      // of evidence is not evidence of the right recipient.
      actual: actualName || 'UNKNOWN',
      details: passed
        ? `Credited-party name '${actualName}' matches the configured beneficiary name.`
        : `Credited-party name '${actualName || 'UNKNOWN'}' does not match the configured beneficiary name.`,
    };
  }

  private evaluateAmountPillar(
    order: OrderSecurityContext,
    bankPayload: BankTransactionPayload
  ): SecurityPillarEvaluation {
    const passed = this.assertAmount(order.netPayableEtb, bankPayload.amountEtb, DEFAULT_AMOUNT_TOLERANCE_ETB);

    return {
      pillar: 'exact_amount',
      passed,
      expected: order.netPayableEtb,
      actual: bankPayload.amountEtb,
      tolerance: DEFAULT_AMOUNT_TOLERANCE_ETB,
      details: passed
        ? `Paid amount ${bankPayload.amountEtb} ETB meets or exceeds order net payable ${order.netPayableEtb} ETB.`
        : `Underpayment: paid ${bankPayload.amountEtb} ETB is less than required ${order.netPayableEtb} ETB.`,
    };
  }

  private evaluateRecencyPillar(
    order: OrderSecurityContext,
    bankPayload: BankTransactionPayload
  ): SecurityPillarEvaluation {
    const recencyConfig: RecencyWindowConfig = {
      minutesBefore: getNumericSetting('receipt_recency_before_mins', DEFAULT_RECENCY_BEFORE_MINUTES),
      minutesAfter: getNumericSetting('receipt_recency_after_mins', DEFAULT_RECENCY_AFTER_MINUTES),
    };

    const orderDate = parseUtcTimestamp(order.orderCreatedAt);
    const txDate = parseEthiopianBankTimestamp(bankPayload.transactionTimestamp);
    const passed = this.assertRecency(orderDate, bankPayload.transactionTimestamp, recencyConfig);
    const orderTime = orderDate === null ? null : orderDate.getTime();
    const txTime = txDate === null ? null : txDate.getTime();
    const diffMinutes =
      orderTime === null || txTime === null ? null : Math.round((txTime - orderTime) / MILLISECONDS_IN_MINUTE);
    const deltaLabel = diffMinutes === null ? 'unavailable' : `${diffMinutes > 0 ? '+' : ''}${diffMinutes}m`;

    return {
      pillar: 'recency_window',
      passed,
      expected: `within [-${recencyConfig.minutesBefore}m, +${recencyConfig.minutesAfter}m]`,
      actual: `${deltaLabel} relative to order creation`,
      tolerance: recencyConfig.minutesAfter,
      details: passed
        ? `Transaction timestamp is within valid window (${deltaLabel} delta).`
        : txTime === null
          ? 'The bank receipt carried no readable transaction timestamp, so its age cannot be proven. Manual review is required.'
          : `Transaction timestamp is outside allowable window (${deltaLabel} delta).`,
    };
  }

  // ============================================================================
  // Individual Pillar Assertions
  // ============================================================================

  public async assertAntiReplay(
    normalizedReference: string,
    orderId: string,
    bank: SupportedBank = 'cbe'
  ): Promise<{ passed: boolean; existingOrderId?: string }> {
    const cleanRef = normalizedReference?.trim().toUpperCase();
    if (!cleanRef) {
      return { passed: false };
    }

    const check = checkAntiReplay(bank, cleanRef, orderId);
    return {
      passed: !check.isReplay,
      existingOrderId: check.existingOrderId,
    };
  }

  public assertBeneficiary(
    bank: SupportedBank,
    beneficiaryAccount: string
  ): boolean {
    if (!beneficiaryAccount) return false;

    const cleanActual = this.normalizeAccountString(beneficiaryAccount);
    // Disallow empty, non-digit, or short account strings (must be at least 5 digits)
    if (cleanActual.replace(/\*/g, '').length < 5) return false;

    const whitelist = this.getWhitelistForBank(bank);

    return whitelist.some((acc) => {
      const cleanExpected = this.normalizeAccountString(acc);
      if (cleanExpected.replace(/\*/g, '').length < 5) return false;

      // Masked comparison: the portal hides the middle digits, so the
      // configured value may carry the same wildcards.
      if (cleanActual.includes('*') || cleanExpected.includes('*')) {
        return this.maskedAccountMatches(cleanActual, cleanExpected);
      }

      // Exact match
      if (cleanActual === cleanExpected) return true;

      // Safe suffix matching for telebirr/mobile numbers (e.g. 09... vs 9...)
      // Shorter number must have at least 9 digits, and length difference cannot exceed 2
      const minLen = Math.min(cleanActual.length, cleanExpected.length);
      const lenDiff = Math.abs(cleanActual.length - cleanExpected.length);
      if (minLen >= 9 && lenDiff <= 2) {
        return cleanActual.endsWith(cleanExpected) || cleanExpected.endsWith(cleanActual);
      }

      return false;
    });
  }

  public assertAmount(
    orderAmountEtb: number,
    paidAmountEtb: number,
    toleranceEtb: number = DEFAULT_AMOUNT_TOLERANCE_ETB
  ): boolean {
    if (isNaN(orderAmountEtb) || isNaN(paidAmountEtb)) return false;
    return paidAmountEtb >= (orderAmountEtb - toleranceEtb);
  }

  public assertRecency(
    orderCreatedAt: Date | null,
    txTimestamp: Date | null,
    windowMinutes?: RecencyWindowConfig
  ): boolean {
    const beforeMins = windowMinutes?.minutesBefore ?? DEFAULT_RECENCY_BEFORE_MINUTES;
    const afterMins = windowMinutes?.minutesAfter ?? DEFAULT_RECENCY_AFTER_MINUTES;

    // Fail closed on an absent or unparseable ORDER timestamp, for the same
    // reason as the bank timestamp below: the recency window is anchored on the
    // order's creation time, so substituting "now" for an unknown order date
    // would centre the window on the present and defeat stale-receipt
    // detection entirely.
    const orderDate = parseUtcTimestamp(orderCreatedAt);
    if (orderDate === null) return false;

    // Fail closed on an absent or unparseable bank timestamp. Treating "unknown"
    // as "now" would let an arbitrarily old receipt satisfy the window and would
    // silently disable stale-receipt detection.
    const txDate = parseEthiopianBankTimestamp(txTimestamp);
    if (txDate === null) return false;

    const orderTime = orderDate.getTime();
    const txTime = txDate.getTime();

    const minAllowed = orderTime - beforeMins * MILLISECONDS_IN_MINUTE;
    const maxAllowed = orderTime + afterMins * MILLISECONDS_IN_MINUTE;

    return txTime >= minAllowed && txTime <= maxAllowed;
  }

  // ============================================================================
  // Configuration Resolution & Normalization
  // ============================================================================

  private getWhitelistForBank(bank: SupportedBank): string[] {
    if (bank === 'unknown') return [];
    const config = BANK_BENEFICIARY_CONFIG_MAP[bank];
    if (!config) return [];

    const accounts: string[] = [];
    const jsonList = getSetting(config.jsonSettingKey, '');
    const legacyAccount = getSetting(config.legacySettingKey, config.fallbackAccount);

    if (jsonList) {
      try {
        const parsed = JSON.parse(jsonList);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === 'string') accounts.push(item);
          }
        }
      } catch (err: unknown) {
        logger.warn({ jsonSettingKey: config.jsonSettingKey, err }, 'Failed to parse beneficiary JSON setting');
      }
    }

    if (legacyAccount && !accounts.includes(legacyAccount)) {
      accounts.push(legacyAccount);
    }

    return accounts;
  }

  /**
   * Normalises an account for whitelist comparison.
   *
   * Masking is preserved, because the bank portal renders credited accounts in
   * masked form ("2519****1717"). Stripping the asterisks produced "25191717",
   * which can never equal a configured account, so the pillar failed on every
   * genuine Telebirr receipt. Operators now configure the masked form (e.g.
   * "2519****1717") and only the visible digits are compared.
   */
  private normalizeAccountString(raw: string): string {
    const masked = raw.replace(/[xX]/g, '*').replace(/[^\d*]/g, '');
    const digits = masked.replace(/\*/g, '');
    if (digits.startsWith('251') && !masked.includes('*')) {
      return '0' + digits.slice(3);
    }
    return masked;
  }

  /**
   * Compares an actual account against a configured one, treating '*' in
   * either value as a single-digit wildcard. Requires equal length so a short
   * pattern cannot match a longer account by accident.
   */
  private maskedAccountMatches(cleanActual: string, cleanExpected: string): boolean {
    if (cleanActual.length !== cleanExpected.length) return false;
    for (let i = 0; i < cleanActual.length; i++) {
      const a = cleanActual[i];
      const e = cleanExpected[i];
      if (e === '*' || a === '*') continue;
      if (a !== e) return false;
    }
    return true;
  }
}
