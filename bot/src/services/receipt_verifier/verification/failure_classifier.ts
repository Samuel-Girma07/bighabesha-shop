import {
  ReceiptVerificationError,
  BankPortalUnavailableError,
  PortalGeoblockedError,
  ProxyConfigError,
  RateLimitError,
  UnconfirmedTransactionError,
  InvalidReceiptReferenceError,
  UnsupportedBankError,
  BankTransactionPayload,
  VerificationFailureCode,
} from '../types.js';

/**
 * Why a verification lane stopped, and therefore whether the chain continues.
 *
 * THE DISTINCTION THAT MAKES FAILOVER WORK
 * ----------------------------------------
 * A lane that fails for OUR reasons should be retried elsewhere. A lane that
 * succeeded but disagrees with the order should not — no other lane will
 * disagree less, and burning their quota to learn that is pure waste.
 *
 *   adapter_fault     We could not READ the receipt. Trip the breaker, fall
 *                     through. A payload with a NaN amount, a null receiver or
 *                     an unparseable date lands here — NOT in `gate_failure`.
 *   infrastructure    Timeout, 5xx, 429, circuit open, DNS/TLS failure. Trip
 *                     the breaker, fall through.
 *   customer_data     The reference is not a real transaction. STOP. No other
 *                     lane will find it either.
 *   gate_failure      The payload was complete and valid but disagrees with the
 *                     order. STOP.
 */
export type LaneFailureClass =
  | 'adapter_fault'
  | 'infrastructure'
  | 'customer_data'
  | 'gate_failure';

export interface LaneFailureVerdict {
  class: LaneFailureClass;
  /** Whether this failure should count against the lane's circuit breaker. */
  tripBreaker: boolean;
  /** Whether the chain should try the next lane. */
  fallThrough: boolean;
  /** Short machine-readable reason for the audit trail. */
  reason: string;
  /** The failure code, when the lane produced a typed one. */
  code?: VerificationFailureCode;
}

/**
 * Failure codes that mean "this reference is not a real transaction".
 *
 * `TRANSACTION_NOT_CONFIRMED` is deliberately ABSENT: it means the bank
 * understood the reference but has not settled the payment, which is a
 * legitimate, retryable customer state, not a malformed reference.
 */
const CUSTOMER_DATA_CODES: ReadonlySet<VerificationFailureCode> = new Set<VerificationFailureCode>([
  'INVALID_RECEIPT_REFERENCE',
  'UNSUPPORTED_BANK',
  'RECEIPT_ALREADY_USED',
]);

/** Failure codes that mean "our fault, not the customer's". */
const INFRASTRUCTURE_CODES: ReadonlySet<VerificationFailureCode> = new Set<VerificationFailureCode>([
  'BANK_PORTAL_UNAVAILABLE',
  'PORTAL_GEOBLOCKED',
  'PROXY_CONFIG_INVALID',
  'RATE_LIMITED',
]);

/**
 * Classifies a typed error thrown by a lane.
 *
 * @param err     The thrown value.
 * @param options `ambiguousNotFoundCodes` lets a lane declare that one of its
 *   failure codes is genuinely ambiguous. cheki is the motivating case: it
 *   answers an INVALID CBE token with the same 502 it uses for a real outage,
 *   so treating that 502 as infrastructure would let a single customer typo
 *   trip the breaker and disable the lane for everyone.
 */
export function classifyLaneError(
  err: unknown,
  options: { ambiguousNotFoundCodes?: ReadonlySet<VerificationFailureCode> } = {}
): LaneFailureVerdict {
  const ambiguous = options.ambiguousNotFoundCodes ?? new Set<VerificationFailureCode>();

  if (err instanceof ReceiptVerificationError) {
    const code = err.problemDetails.code;

    if (ambiguous.has(code)) {
      // Ambiguous: fall through (another lane may well succeed) but do NOT
      // penalise the lane. The degraded-lane detector, which reads a rate over
      // a window rather than counting individual results, is what notices a
      // genuinely dead lane.
      return {
        class: 'infrastructure',
        tripBreaker: false,
        fallThrough: true,
        reason: 'ambiguous_upstream_result',
        code,
      };
    }

    if (CUSTOMER_DATA_CODES.has(code)) {
      return { class: 'customer_data', tripBreaker: false, fallThrough: false, reason: code, code };
    }

    if (INFRASTRUCTURE_CODES.has(code)) {
      return { class: 'infrastructure', tripBreaker: true, fallThrough: true, reason: code, code };
    }

    // A payload-bearing 422 (beneficiary mismatch, amount mismatch, expired,
    // not confirmed) means the lane DID read the receipt and the receipt
    // disagrees with the order. That is a gate verdict, not a lane fault.
    return { class: 'gate_failure', tripBreaker: false, fallThrough: false, reason: code, code };
  }

  // An untyped throw — a thrown string, a raw TypeError from JSON parsing, an
  // axios-style network object. Treat as our fault and fall through.
  return {
    class: 'infrastructure',
    tripBreaker: true,
    fallThrough: true,
    reason: 'untyped_error',
    code: 'INTERNAL_ENGINE_ERROR',
  };
}

/**
 * Structural validity of a lane payload.
 *
 * THIS IS THE RULE THE WHOLE DESIGN TURNS ON.
 *
 * A `NaN` amount is not "the customer paid the wrong amount". It is "we could
 * not read the receipt". Conflating the two reads as a gate failure, stops the
 * chain, and silently disables failover — the customer is sent to manual review
 * for a portal that was merely returning an unfamiliar payload shape, while the
 * lane that could have answered never got asked.
 *
 * So completeness is checked BEFORE the payload ever reaches the security gate.
 * Anything structurally unusable is an `adapter_fault`: trip the breaker, fall
 * through, let another lane try.
 */
export interface PayloadValidation {
  usable: boolean;
  /** Populated when `usable` is false: which field was unreadable. */
  missingField?: string;
}

export function validateLanePayload(payload: BankTransactionPayload | undefined): PayloadValidation {
  if (!payload) return { usable: false, missingField: 'payload' };

  if (!payload.transactionReference || payload.transactionReference.trim().length === 0) {
    return { usable: false, missingField: 'transactionReference' };
  }

  // Number.isNaN is the check, NOT `typeof === 'number'`: a NaN IS a number,
  // and `NaN >= 750` is false, which is exactly how a read failure would
  // masquerade as an underpayment.
  if (!Number.isFinite(payload.amountEtb)) {
    return { usable: false, missingField: 'amountEtb' };
  }

  if (payload.amountEtb <= 0) {
    return { usable: false, missingField: 'amountEtb' };
  }

  // The recency pillar fails closed on a null timestamp by design, so a lane
  // that cannot produce one can never pass the gate. Failing here instead
  // means the chain tries a lane that can.
  if (!payload.transactionTimestamp) {
    return { usable: false, missingField: 'transactionTimestamp' };
  }

  // Pillar 0 requires a status. Absent is unconfirmed, not assumed successful.
  if (!payload.transactionStatus || payload.transactionStatus.trim().length === 0) {
    return { usable: false, missingField: 'transactionStatus' };
  }

  // Pillar 2 needs a credited account; an empty one cannot match any whitelist.
  if (!payload.beneficiaryAccount || payload.beneficiaryAccount.trim().length === 0) {
    return { usable: false, missingField: 'beneficiaryAccount' };
  }

  return { usable: true };
}

export { RateLimitError };