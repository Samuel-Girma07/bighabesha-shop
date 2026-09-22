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

/** Permitted domain hostnames for Commercial Bank of Ethiopia (CBE) egress */
export const CBE_PERMITTED_HOSTNAMES = Object.freeze([
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
}

export const BANK_BENEFICIARY_CONFIG_MAP: Readonly<Record<Exclude<SupportedBank, 'unknown'>, BankBeneficiaryConfig>> = Object.freeze({
  cbe: {
    jsonSettingKey: 'receipt_cbe_beneficiaries',
    legacySettingKey: 'cbe_account',
    fallbackAccount: '0000000000000',
  },
  telebirr: {
    jsonSettingKey: 'receipt_telebirr_beneficiaries',
    legacySettingKey: 'telebirr_account',
    fallbackAccount: '0000000000',
  },
  abyssinia: {
    jsonSettingKey: 'receipt_abyssinia_beneficiaries',
    legacySettingKey: 'abyssinia_account',
    fallbackAccount: '0000000000000',
  },
});

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
 */
export function parseEthiopianBankTimestamp(rawDateStr: string | Date | undefined | null): Date {
  if (!rawDateStr) return new Date();
  if (rawDateStr instanceof Date) return isNaN(rawDateStr.getTime()) ? new Date() : rawDateStr;

  const trimmed = String(rawDateStr).trim();
  if (!trimmed) return new Date();

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

  return new Date();
}

/**
 * Normalizes SQLite CURRENT_TIMESTAMP strings ("YYYY-MM-DD HH:MM:SS") into an absolute UTC Date.
 * SQLite CURRENT_TIMESTAMP is generated in UTC without a trailing 'Z'.
 * Without explicit 'Z', JavaScript engines parse the string in the host's local timezone.
 */
export function parseUtcTimestamp(rawDate: string | Date | undefined | null): Date {
  if (!rawDate) return new Date();
  if (rawDate instanceof Date) return isNaN(rawDate.getTime()) ? new Date() : rawDate;

  const trimmed = String(rawDate).trim();
  if (!trimmed) return new Date();

  // If it's SQLite CURRENT_TIMESTAMP "YYYY-MM-DD HH:MM:SS" without timezone:
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(trimmed.replace(' ', 'T') + 'Z');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00Z`);
  }
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return new Date(trimmed.replace(' ', 'T') + 'Z');
  }
  return new Date(trimmed);
}
