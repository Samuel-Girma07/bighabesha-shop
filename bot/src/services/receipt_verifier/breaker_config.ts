/**
 * Bighabesha Shop - Ethiopian Bank Receipt Verification Engine
 * Circuit Breaker Runtime Configuration Resolver
 *
 * Single point of truth for translating admin-tunable settings rows into breaker options.
 * The Admin Dashboard stores the cooldown in SECONDS while `CircuitBreaker` works in
 * MILLISECONDS — this module owns that conversion so no adapter can drift from it again.
 */

import { getNumericSetting } from '../settings.service.js';
import {
  CIRCUIT_BREAKER_COOLDOWN_SEC_SETTING_KEY,
  CIRCUIT_BREAKER_THRESHOLD_SETTING_KEY,
  DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS,
  DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
} from './constants.js';

export interface ResolvedCircuitBreakerConfig {
  /** Consecutive upstream failures required before tripping OPEN */
  failureThreshold: number;
  /** Cooldown window before a HALF_OPEN probe, in milliseconds */
  cooldownMs: number;
}

/** Default cooldown expressed in seconds (the unit the settings table uses). */
export const DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SEC = Math.round(
  DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS / 1000
);

/**
 * Reads the persisted breaker configuration, falling back to safe defaults when the settings
 * table is unavailable (e.g. adapter constructed before DB init) or holds an invalid value.
 * Values are clamped away from < 1 so a bad setting can never disable failure protection.
 */
export function resolveCircuitBreakerConfig(): ResolvedCircuitBreakerConfig {
  const rawThreshold = getNumericSetting(
    CIRCUIT_BREAKER_THRESHOLD_SETTING_KEY,
    DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD
  );
  const rawCooldownSec = getNumericSetting(
    CIRCUIT_BREAKER_COOLDOWN_SEC_SETTING_KEY,
    DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SEC
  );

  const failureThreshold =
    Number.isInteger(rawThreshold) && rawThreshold >= 1
      ? rawThreshold
      : DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD;

  const cooldownSec =
    Number.isFinite(rawCooldownSec) && rawCooldownSec >= 1
      ? rawCooldownSec
      : DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SEC;

  return { failureThreshold, cooldownMs: cooldownSec * 1000 };
}