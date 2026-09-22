import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { setSetting } from '../src/services/settings.service.js';
import { CircuitBreaker } from '../src/services/receipt_verifier/circuit_breaker.js';
import { CbeBankAdapter } from '../src/services/receipt_verifier/adapters/cbe.adapter.js';
import { TelebirrAdapter } from '../src/services/receipt_verifier/adapters/telebirr.adapter.js';
import { BankAdapterRegistry } from '../src/services/receipt_verifier/adapters/registry.js';
import { ReceiptOrchestrator } from '../src/services/receipt_verifier/orchestrator.service.js';
import {
  refreshReceiptOrchestratorSettings,
  setReceiptOrchestratorForTest,
} from '../src/services/receipt_verifier/index.js';
import {
  DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SEC,
  resolveCircuitBreakerConfig,
} from '../src/services/receipt_verifier/breaker_config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

/** Reads the protected breaker off an adapter for white-box configuration assertions. */
function breakerOf(adapter: unknown): CircuitBreaker {
  return (adapter as unknown as { circuitBreaker: CircuitBreaker }).circuitBreaker;
}

const DEFAULT_COOLDOWN_MS = DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SEC * 1000;

describe('Circuit breaker runtime configuration (admin-tunable settings)', () => {
  beforeEach(() => {
    initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    setReceiptOrchestratorForTest(undefined);
    closeDatabase();
    vi.useRealTimers();
  });

  it('reads the canonical cooldown key (seconds) and converts it to milliseconds', () => {
    setSetting('receipt_circuit_breaker_threshold', '7');
    setSetting('receipt_circuit_breaker_cooldown_sec', '120');

    expect(resolveCircuitBreakerConfig()).toEqual({ failureThreshold: 7, cooldownMs: 120_000 });
  });

  it('falls back to safe defaults when the settings hold missing or invalid values', () => {
    // Fresh migrations seed threshold=5 / cooldown=60, which are also the code defaults.
    expect(resolveCircuitBreakerConfig()).toEqual({
      failureThreshold: 5,
      cooldownMs: DEFAULT_COOLDOWN_MS,
    });

    // A stray/legacy bad value must never disable failure protection.
    setSetting('receipt_circuit_breaker_threshold', '0');
    setSetting('receipt_circuit_breaker_cooldown_sec', '-30');

    expect(resolveCircuitBreakerConfig()).toEqual({
      failureThreshold: 5,
      cooldownMs: DEFAULT_COOLDOWN_MS,
    });
  });

  it('applies persisted settings to both adapters at construction time', () => {
    setSetting('receipt_circuit_breaker_threshold', '9');
    setSetting('receipt_circuit_breaker_cooldown_sec', '150');

    for (const adapter of [new CbeBankAdapter(), new TelebirrAdapter()]) {
      expect(breakerOf(adapter).getFailureThreshold()).toBe(9);
      expect(breakerOf(adapter).getCooldownMs()).toBe(150_000);
    }
  });

  it('ignores the legacy non-existent `receipt_circuit_breaker_cooldown_ms` key', () => {
    setSetting('receipt_circuit_breaker_cooldown_sec', '30');

    // Simulate the stray legacy row that the old (buggy) implementation read instead of the
    // canonical seconds key — it must have no effect whatsoever.
    getDatabase()
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('receipt_circuit_breaker_cooldown_ms', '999000')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run();

    expect(resolveCircuitBreakerConfig()).toEqual({ failureThreshold: 5, cooldownMs: 30_000 });
  });

  it('re-applies settings to the live orchestrator adapters without a process restart', () => {
    setSetting('receipt_circuit_breaker_cooldown_sec', '60');

    const registry = new BankAdapterRegistry([new CbeBankAdapter(), new TelebirrAdapter()]);
    const orchestrator = new ReceiptOrchestrator(undefined, registry, undefined);
    setReceiptOrchestratorForTest(orchestrator);

    const adapters = registry.getAll();
    expect(adapters.length).toBe(2);
    for (const adapter of adapters) {
      expect(breakerOf(adapter).getCooldownMs()).toBe(60_000);
    }

    // An administrator raises the cooldown from the dashboard; the live breakers must follow.
    setSetting('receipt_circuit_breaker_cooldown_sec', '45');
    refreshReceiptOrchestratorSettings();

    for (const adapter of adapters) {
      expect(breakerOf(adapter).getCooldownMs()).toBe(45_000);
    }
  });

  it('preserves breaker state and failure counters when runtime config is applied', () => {
    const registry = new BankAdapterRegistry([new CbeBankAdapter(), new TelebirrAdapter()]);
    setReceiptOrchestratorForTest(new ReceiptOrchestrator(undefined, registry, undefined));

    const breaker = breakerOf(registry.getAll()[0]);
    for (let i = 0; i < 5; i += 1) breaker.recordFailure(new Error('upstream flap'));
    expect(breaker.getState()).toBe('OPEN');

    setSetting('receipt_circuit_breaker_cooldown_sec', '90');
    refreshReceiptOrchestratorSettings();

    expect(breaker.getCooldownMs()).toBe(90_000);
    // The trip state is preserved rather than silently reset to CLOSED.
    expect(breaker.getState()).toBe('OPEN');
  });

  it('honours the configured cooldown when transitioning OPEN -> HALF_OPEN', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'));

    const breaker = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 60_000 });
    for (let i = 0; i < 5; i += 1) breaker.recordFailure(new Error('upstream flap'));

    expect(breaker.canAttempt()).toBe(false);

    vi.setSystemTime(new Date('2026-09-16T12:00:59.000Z'));
    expect(breaker.canAttempt()).toBe(false);

    vi.setSystemTime(new Date('2026-09-16T12:01:00.000Z'));
    expect(breaker.canAttempt()).toBe(true);
  });

  it('rejects out-of-range values passed to applyConfig', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5, cooldownMs: DEFAULT_COOLDOWN_MS });
    breaker.applyConfig({ failureThreshold: 0, cooldownMs: -1 });

    expect(breaker.getFailureThreshold()).toBe(5);
    expect(breaker.getCooldownMs()).toBe(DEFAULT_COOLDOWN_MS);
  });
});
