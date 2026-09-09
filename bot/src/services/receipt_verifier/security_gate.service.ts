import { checkAntiReplay } from '../../db/receipt_evidence.dao.js';
import { getSetting, getNumericSetting } from '../settings.service.js';
import { logger } from '../../logger/index.js';
import {
  BANK_BENEFICIARY_CONFIG_MAP,
  DEFAULT_RECENCY_BEFORE_MINUTES,
  DEFAULT_RECENCY_AFTER_MINUTES,
  DEFAULT_AMOUNT_TOLERANCE_ETB,
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

    const passed = this.assertRecency(order.orderCreatedAt, bankPayload.transactionTimestamp, recencyConfig);
    const diffMinutes = Math.round(
      (bankPayload.transactionTimestamp.getTime() - order.orderCreatedAt.getTime()) / MILLISECONDS_IN_MINUTE
    );

    return {
      pillar: 'recency_window',
      passed,
      expected: `within [-${recencyConfig.minutesBefore}m, +${recencyConfig.minutesAfter}m]`,
      actual: `${diffMinutes > 0 ? '+' : ''}${diffMinutes}m relative to order creation`,
      tolerance: recencyConfig.minutesAfter,
      details: passed
        ? `Transaction timestamp is within valid window (${diffMinutes}m delta).`
        : `Transaction timestamp is outside allowable window (${diffMinutes}m delta).`,
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
    if (cleanActual.length < 5) return false;

    const whitelist = this.getWhitelistForBank(bank);

    return whitelist.some((acc) => {
      const cleanExpected = this.normalizeAccountString(acc);
      if (cleanExpected.length < 5) return false;

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
    orderCreatedAt: Date,
    txTimestamp: Date,
    windowMinutes?: RecencyWindowConfig
  ): boolean {
    const beforeMins = windowMinutes?.minutesBefore ?? DEFAULT_RECENCY_BEFORE_MINUTES;
    const afterMins = windowMinutes?.minutesAfter ?? DEFAULT_RECENCY_AFTER_MINUTES;

    const orderTime = orderCreatedAt.getTime();
    const txTime = txTimestamp.getTime();

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

  private normalizeAccountString(raw: string): string {
    const digits = raw.replace(NON_DIGIT_PATTERN, '');
    if (digits.startsWith('251')) {
      return '0' + digits.slice(3);
    }
    return digits;
  }
}
