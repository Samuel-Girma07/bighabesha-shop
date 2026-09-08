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

/** Default circuit breaker consecutive failure threshold before opening */
export const DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;

/** Default circuit breaker cooldown window before entering half-open probe state */
export const DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;

/** Default circuit breaker instance name */
export const DEFAULT_CIRCUIT_BREAKER_NAME = 'bank_adapter';

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
