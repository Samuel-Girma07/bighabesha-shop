/**
 * Bighabesha Shop - Ethiopian Bank Receipt Verification Engine
 * Domain Constants & System Limits
 */

import { SupportedBank } from './types.js';

// ============================================================================
// Network & Timing Constants
// ============================================================================

/** Default network timeout in milliseconds for upstream bank portal queries (7.5s - 8s) */
export const DEFAULT_BANK_NETWORK_TIMEOUT_MS = 8000;

/** Default timeout for image/PDF pre-processing and QR matrix decoding */
export const DEFAULT_INGESTION_TIMEOUT_MS = 5000;

/** Default circuit breaker consecutive failure threshold before opening (tuned to 5 for transient resilience) */
export const DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;

/** Default circuit breaker cooldown window before entering half-open probe state */
export const DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;

/** Default circuit breaker instance name */
export const DEFAULT_CIRCUIT_BREAKER_NAME = 'bank_adapter';

// ============================================================================
// Admin-Tunable Circuit Breaker Setting Keys
// ============================================================================
//
// These keys are the canonical Admin Dashboard surface for breaker tuning and are what the
// migrations / seed / settings allow-list / webapp UI all use. They are the single source of
// truth — do not re-introduce a `receipt_circuit_breaker_cooldown_ms` variant, which historically
// never existed in the database and silently forced the hard-coded default.

/** Consecutive upstream failures before the breaker trips OPEN (integer, seconds-independent). */
export const CIRCUIT_BREAKER_THRESHOLD_SETTING_KEY = 'receipt_circuit_breaker_threshold';

/** Cooldown window before a HALF_OPEN probe, stored in SECONDS (converted to ms at read time). */
export const CIRCUIT_BREAKER_COOLDOWN_SEC_SETTING_KEY = 'receipt_circuit_breaker_cooldown_sec';

/** All settings keys that must trigger a live circuit breaker reconfiguration. */
export const CIRCUIT_BREAKER_SETTING_KEYS: ReadonlySet<string> = new Set([
  CIRCUIT_BREAKER_THRESHOLD_SETTING_KEY,
  CIRCUIT_BREAKER_COOLDOWN_SEC_SETTING_KEY,
]);

/** True when a settings key governs the upstream bank portal circuit breaker. */
export function isCircuitBreakerSettingKey(key: string): boolean {
  return CIRCUIT_BREAKER_SETTING_KEYS.has(key);
}

/** True when any key in the batch governs the upstream bank portal circuit breaker. */
export function containsCircuitBreakerSettingKey(keys: readonly string[]): boolean {
  return keys.some((key) => CIRCUIT_BREAKER_SETTING_KEYS.has(key));
}

// ============================================================================
// Media & Buffer Limits
// ============================================================================

/** Hard memory cap for uploaded receipt image/PDF buffers (10 MB) */
export const MAX_RECEIPT_BUFFER_SIZE_BYTES = 10 * 1024 * 1024;

/** Decompression bomb protection: maximum pixel cap for sharp decoding (16 megapixels) */
export const DEFAULT_MAX_IMAGE_PIXELS = 16_777_216;

/** Hard limit for CSV stock batch import */
export const MAX_CSV_IMPORT_SIZE_BYTES = 5 * 1024 * 1024;

// ============================================================================
// Security Gate Temporal Windows & Defaults
// ============================================================================

/** Default maximum minutes prior to order creation that a slip timestamp is accepted */
export const DEFAULT_RECENCY_BEFORE_MINUTES = 120;

/** Default maximum minutes after order creation that a slip timestamp is accepted */
export const DEFAULT_RECENCY_AFTER_MINUTES = 120;

/** Tolerance in ETB for payment matching (0 means strict exact or overpayment) */
export const DEFAULT_AMOUNT_TOLERANCE_ETB = 0;

// ============================================================================
// SSRF Whitelisted Domains
// ============================================================================

/**
 * Permitted domain hostnames for Commercial Bank of Ethiopia (CBE) egress.
 *
 * `mb.cbe.com.et` is the host that serves the public transaction-detail JSON
 * API this rail verifies against. It is listed explicitly rather than relying on
 * the `cbe.com.et` suffix rule in `assertSsrfSafety`, because that rule is an
 * allow-everything-under-the-zone convenience: if the zone entry were ever
 * narrowed, the API host would silently stop resolving and the rail would fail
 * as SSRF rather than as a configuration drift. Naming the exact host makes the
 * dependency legible and greppable.
 *
 * `apps.cbe.com.et` is retained only as SSRF-policy surface; the legacy
 * port-100 receipt flow that used it is retired (see `cbe.adapter.ts`).
 */
export const CBE_PERMITTED_HOSTNAMES = Object.freeze([
  'mb.cbe.com.et',
  'apps.cbe.com.et',
  'cbe.com.et',
]);

/** Permitted domain hostnames for Ethio Telecom Telebirr confirmation portal egress */
export const TELEBIRR_PERMITTED_HOSTNAMES = Object.freeze([
  'transactioninfo.ethiotelecom.et',
  'telebirr.et',
]);

// ============================================================================
// RFC 7807 Problem Details Defaults
// ============================================================================

export const RFC7807_BASE_URL = 'https://bighabesha.shop/errors';
export const DEFAULT_ERROR_INSTANCE = '/api/receipts/verify';

// ============================================================================
// Beneficiary Configuration Mapping
// ============================================================================

export interface BankBeneficiaryConfig {
  readonly jsonSettingKey: string;
  readonly legacySettingKey: string;
  readonly fallbackAccount: string;
  /**
   * Holds the credited-party NAME the bank portal is expected to render for
   * this shop's receiving account, as one plain-text line.
   *
   * The account whitelist alone is a weak signal: every rail masks the credited
   * account, so a match only proves a handful of visible digits. The name is
   * published in cleartext and is a far stronger signal, so it is worth an
   * independent check.
   *
   * Intentionally ships UNSET. No inbound customer -> shop payment has been
   * captured yet, so the value Telebirr actually renders for this shop's
   * account is still unknown, and guessing it would either reject every genuine
   * receipt or (worse) accept a wrong one. While the value is blank the name
   * pillar stays dormant and the masked-account pillar carries the load.
   */
  readonly expectedNameSettingKey: string;
}

export const BANK_BENEFICIARY_CONFIG_MAP: Readonly<Record<Exclude<SupportedBank, 'unknown'>, BankBeneficiaryConfig>> = Object.freeze({
  cbe: {
    jsonSettingKey: 'receipt_cbe_beneficiaries',
    legacySettingKey: 'cbe_account',
    fallbackAccount: '0000000000000',
    expectedNameSettingKey: 'receipt_cbe_expected_name',
  },
  telebirr: {
    jsonSettingKey: 'receipt_telebirr_beneficiaries',
    legacySettingKey: 'telebirr_account',
    fallbackAccount: '0000000000',
    expectedNameSettingKey: 'receipt_telebirr_expected_name',
  },
  abyssinia: {
    jsonSettingKey: 'receipt_abyssinia_beneficiaries',
    legacySettingKey: 'abyssinia_account',
    fallbackAccount: '0000000000000',
    expectedNameSettingKey: 'receipt_abyssinia_expected_name',
  },
});

// ============================================================================
// Credited-Party Name Normalization
// ============================================================================
//
// Portals render the credited-party name inconsistently: casing, trailing legal
// suffixes ("Shop PLC"), bilingual rendering, doubled or dropped letters in
// transliterated Amharic (invented pair "Xobentosa" / "Xobentossa" — a spelling
// illustration, NOT a real payer's name) and the occasional accent all show up as
// cosmetic noise around the same identity. Comparing raw strings would therefore
// reject real receipts and teach operators to distrust the check. Token matching
// tolerates the cosmetics; the account whitelist remains the independent second
// signal.

/**
 * Reduces a party name to lowercase, diacritic-free, punctuation-free tokens.
 *
 * Ethiopic script survives intact: NFKD does not decompose Ethiopic syllables,
 * and the combining-mark ranges stripped below only hold Latin marks, so a name
 * written in Amharic compares against another Amharic name token for token.
 */
export function normalizeNameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Anything that is not a letter or digit becomes a separator, so
    // "Bighabesha Shop, PLC." and "bighabesha-shop-plc" tokenize identically.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Characters of spelling drift tolerated inside a single token.
 *
 * Longer tokens get more room: transcriptions of Amharic names lose or double a
 * letter routinely ("Xobentosa" -> "Xobentossa" — invented pair, not a real
 * payer's name), and demanding an exact match there would make the pillar
 * unusable. Very short tokens must match exactly, because one edit inside a
 * 2-3 character token is indistinguishable from a different name.
 */
function toleratedEditDistance(token: string): number {
  if (token.length >= 8) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

/** True when every token of `shorter` is present in `longer`, allowing small spelling drift. */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const tolerance = Math.max(toleratedEditDistance(a), toleratedEditDistance(b));
  if (tolerance === 0) return false;
  return editDistanceWithinBudget(a, b, tolerance);
}

/** Levenshtein distance, short-circuited once it provably exceeds `budget`. */
function editDistanceWithinBudget(a: string, b: string, budget: number): boolean {
  if (Math.abs(a.length - b.length) > budget) return false;

  // Rolling two-row DP: only the previous row is ever needed, so a long name
  // cannot turn this into a quadratic memory sink.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
      if (current[j] < rowMin) rowMin = current[j];
    }
    // Every remaining cell can only grow, so an all-over-budget row is final.
    if (rowMin > budget) return false;
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length] <= budget;
}

/**
 * True when one party name is a token-wise match of the other: every token of
 * the SHORTER name must be accounted for in the LONGER one.
 *
 * Matching either direction is what absorbs the cosmetic differences portals
 * introduce: "Bighabesha Shop" is a subset of "Bighabesha Shop PLC" and of
 * "BIGHABESHA SHOP - BIGHABESHA DIGITAL SERVICES", so a legal suffix or a
 * bilingual rendering does not have to be reproduced verbatim in the setting.
 *
 * An empty or missing side NEVER matches. A receipt whose credited-party name
 * the portal did not render carries no name evidence at all, and treating that
 * as a pass would silently disable the pillar.
 */
export function beneficiaryNameMatches(expected: string | null | undefined, actual: string | null | undefined): boolean {
  const expectedTokens = normalizeNameTokens(expected);
  const actualTokens = normalizeNameTokens(actual);
  if (expectedTokens.length === 0 || actualTokens.length === 0) return false;

  const [shorter, longer] =
    expectedTokens.length <= actualTokens.length
      ? [expectedTokens, actualTokens]
      : [actualTokens, expectedTokens];

  return shorter.every((token) => longer.some((candidate) => tokensMatch(token, candidate)));
}

/**
 * Order states in which the engine may execute an automated fulfillment.
 *
 * `awaiting_payment` is the normal case. `pending_approval` MUST also be
 * allowed: a failed verification attempt moves the order into the
 * manual-review queue, so it is the ordinary resting state after any rejected
 * submission. Hard-restricting to `awaiting_payment` would make it impossible
 * for a customer to submit a corrected receipt after a bad first attempt.
 *
 * Everything else is either already fulfilled (a second fulfillment would
 * double-deliver and overwrite `fulfillment_payload`) or terminal.
 *
 * Lives here, not in `orchestrator.service.ts`, so that the Telegram intake
 * handlers can consult it without pulling in the pipeline's heavy module graph
 * (`sharp`, `cheerio`, the bank adapters). `orchestrator.service.ts` re-exports
 * it, so `AUTO_FULFILLABLE_ORDER_STATUSES` still resolves from either module and
 * there is exactly one definition.
 */
export const AUTO_FULFILLABLE_ORDER_STATUSES: ReadonlySet<string> = new Set([
  'awaiting_payment',
  'pending_approval',
]);

// ============================================================================
// Temporal & Timezone Normalization Helpers (Phase 4: EAT UTC+3 Parity)
// ============================================================================

/** Ethiopian Standard Timezone offset string (East Africa Time, UTC+3) */
export const ETHIOPIAN_TIMEZONE_OFFSET = '+03:00';
export const ETHIOPIAN_TIMEZONE_OFFSET_HOURS = 3;

/**
 * Parses an Ethiopian bank timestamp string (from CBE or Telebirr) into a Date object.
 * Ethiopian banking portals and mobile money operate in East Africa Time (EAT = UTC+3).
 * If the raw timestamp string lacks explicit timezone information (+HH:MM or Z),
 * this function explicitly pins it to UTC+3 (+03:00) so that servers running in UTC
 * evaluate temporal recency accurately without false RECEIPT_EXPIRED rejections.
 *
 * Returns `null` when the value is absent or genuinely unparseable.
 *
 * This MUST NOT fall back to `new Date()`. Substituting the current time for an
 * unknown transaction date makes the recency gate compare "now" against the order,
 * so an arbitrarily old receipt would satisfy the window and stale-receipt detection
 * would be silently defeated. Callers fail closed on `null`.
 */
export function parseEthiopianBankTimestamp(rawDateStr: string | Date | undefined | null): Date | null {
  if (rawDateStr === null || rawDateStr === undefined) return null;
  if (rawDateStr instanceof Date) return isNaN(rawDateStr.getTime()) ? null : rawDateStr;

  const trimmed = String(rawDateStr).trim();
  if (!trimmed) return null;

  // 0. Day-first dashed format: DD-MM-YYYY[ T]HH:mm:ss(.sss)?
  //
  // Verified against a live Telebirr receipt page, which renders the payment
  // date as "04-10-2026 10:36:07".
  //
  // This MUST be tested before the explicit-offset shortcut below. That regex
  // is `[+-]\d{2}:?\d{2}$`, and the tail of "04-10-2026" is "-2026", which it
  // matches as an offset — so the value reached `new Date()` first, where V8
  // reads it month-first and silently yields April 10 instead of October 4.
  // A day-first date must never be handed to the engine's default parser.
  const dashDayFirstMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/);
  if (dashDayFirstMatch) {
    const [, d, m, y, hh = '00', mm = '00', ss = '00', ms] = dashDayFirstMatch;
    const msStr = ms ? `.${ms}` : '';
    const isoString = `${y}-${m}-${d}T${hh}:${mm}:${ss}${msStr}+03:00`;
    const parsed = new Date(isoString);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // If already has explicit timezone offset or Zulu indicator, parse directly
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }

  // 1. Check ISO format: YYYY-MM-DD[ T]HH:mm:ss(.sss)?
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/);
  if (isoMatch) {
    const [, y, m, d, hh = '00', mm = '00', ss = '00', ms] = isoMatch;
    const msStr = ms ? `.${ms}` : '';
    const isoString = `${y}-${m}-${d}T${hh}:${mm}:${ss}${msStr}+03:00`;
    const parsed = new Date(isoString);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // 2. Check Slash format: DD/MM/YYYY[ T]HH:mm:ss(.sss)? (standard Ethiopian bank slip format)
  const slashMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/);
  if (slashMatch) {
    const [, d, m, y, hh = '00', mm = '00', ss = '00', ms] = slashMatch;
    const msStr = ms ? `.${ms}` : '';
    const isoString = `${y}-${m}-${d}T${hh}:${mm}:${ss}${msStr}+03:00`;
    const parsed = new Date(isoString);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // 3. Check Slash format: YYYY/MM/DD[ T]HH:mm:ss(.sss)?
  const slashYmdMatch = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/);
  if (slashYmdMatch) {
    const [, y, m, d, hh = '00', mm = '00', ss = '00', ms] = slashYmdMatch;
    const msStr = ms ? `.${ms}` : '';
    const isoString = `${y}-${m}-${d}T${hh}:${mm}:${ss}${msStr}+03:00`;
    const parsed = new Date(isoString);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // Fallback: try parsing with +03:00 appended
  const fallback = new Date(`${trimmed.replace(' ', 'T')}+03:00`);
  if (!isNaN(fallback.getTime())) return fallback;

  const direct = new Date(trimmed);
  if (!isNaN(direct.getTime())) return direct;

  return null;
}

/**
 * Normalizes SQLite CURRENT_TIMESTAMP strings ("YYYY-MM-DD HH:MM:SS") into an absolute UTC Date.
 * SQLite CURRENT_TIMESTAMP is generated in UTC without a trailing 'Z'.
 * Without explicit 'Z', JavaScript engines parse the string in the host's local timezone.
 *
 * Returns `null` when the value is absent or genuinely unparseable.
 *
 * This MUST NOT fall back to `new Date()`. This parser anchors the recency
 * window on the ORDER's creation time. Substituting the current time for an
 * unknown order date slides the window to centre on "now", so an arbitrarily
 * old receipt satisfies it and stale-receipt detection is silently defeated.
 * Callers fail closed on `null` by routing to manual review. This mirrors the
 * contract already applied to the bank-side `parseEthiopianBankTimestamp`.
 */
export function parseUtcTimestamp(rawDate: string | Date | undefined | null): Date | null {
  if (rawDate === null || rawDate === undefined) return null;
  if (rawDate instanceof Date) return isNaN(rawDate.getTime()) ? null : rawDate;

  const trimmed = String(rawDate).trim();
  if (!trimmed) return null;

  // If it's SQLite CURRENT_TIMESTAMP "YYYY-MM-DD HH:MM:SS" without timezone:
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return orNull(new Date(trimmed.replace(' ', 'T') + 'Z'));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return orNull(new Date(`${trimmed}T00:00:00Z`));
  }
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return orNull(new Date(trimmed.replace(' ', 'T') + 'Z'));
  }
  return orNull(new Date(trimmed));
}

/** Collapses an Invalid Date to `null` so callers get one failure shape. */
function orNull(date: Date): Date | null {
  return isNaN(date.getTime()) ? null : date;
}
