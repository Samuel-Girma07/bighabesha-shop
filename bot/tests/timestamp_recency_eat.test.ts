import { describe, it, expect } from 'vitest';
import { SecurityGateService } from '../src/services/receipt_verifier/security_gate.service.js';
import {
  parseEthiopianBankTimestamp,
  parseUtcTimestamp,
} from '../src/services/receipt_verifier/constants.js';

describe('Phase 4: Timestamp / Recency Validation (EAT UTC+3 vs UTC Parity)', () => {
  const gate = new SecurityGateService();

  describe('parseEthiopianBankTimestamp helper', () => {
    it('correctly pins ISO timestamp without timezone to EAT (+03:00)', () => {
      // 15:30 EAT is 12:30 UTC
      const parsed = parseEthiopianBankTimestamp('2026-09-16 15:30:00');
      expect(parsed.toISOString()).toBe('2026-09-16T12:30:00.000Z');
    });

    it('correctly parses Ethiopian bank slash format DD/MM/YYYY HH:mm:ss to EAT (+03:00)', () => {
      // 16/09/2026 15:30:00 EAT is 2026-09-16T12:30:00.000Z
      const parsed = parseEthiopianBankTimestamp('16/09/2026 15:30:00');
      expect(parsed.toISOString()).toBe('2026-09-16T12:30:00.000Z');
    });

    it('preserves timestamps that already have explicit timezone or Z', () => {
      const parsed = parseEthiopianBankTimestamp('2026-09-16T12:30:00.000Z');
      expect(parsed.toISOString()).toBe('2026-09-16T12:30:00.000Z');

      const parsedOffset = parseEthiopianBankTimestamp('2026-09-16T15:30:00+03:00');
      expect(parsedOffset.toISOString()).toBe('2026-09-16T12:30:00.000Z');
    });
  });

  describe('parseUtcTimestamp helper', () => {
    it('correctly normalizes SQLite CURRENT_TIMESTAMP without timezone to UTC Z', () => {
      const parsed = parseUtcTimestamp('2026-09-16 12:25:00');
      expect(parsed.toISOString()).toBe('2026-09-16T12:25:00.000Z');
    });
  });

  describe('assertRecency with EAT bank slip timestamps', () => {
    it('validates a receipt paid 5 minutes after order creation (eliminating 3-hour false rejection)', () => {
      // Order created in SQLite at 12:25:00 UTC
      const orderCreatedAt = new Date('2026-09-16T12:25:00.000Z');
      // Bank portal reports transaction at 15:30:00 local time (which is 12:30:00 UTC, 5 mins later)
      const txTimestamp = parseEthiopianBankTimestamp('2026-09-16 15:30:00');

      // With default window [-120m, +120m], this MUST pass
      const passed = gate.assertRecency(orderCreatedAt, txTimestamp);
      expect(passed).toBe(true);
    });

    it('validates a receipt paid 10 minutes prior to order creation (pre-payment)', () => {
      // Order created in SQLite at 12:30:00 UTC
      const orderCreatedAt = new Date('2026-09-16T12:30:00.000Z');
      // Bank portal reports transaction at 15:20:00 EAT (12:20:00 UTC)
      const txTimestamp = parseEthiopianBankTimestamp('2026-09-16 15:20:00');

      const passed = gate.assertRecency(orderCreatedAt, txTimestamp);
      expect(passed).toBe(true);
    });

    it('correctly rejects a genuinely stale receipt paid 5 hours ago', () => {
      // Order created at 12:00:00 UTC
      const orderCreatedAt = new Date('2026-09-16T12:00:00.000Z');
      // Bank receipt from 07:00:00 UTC (10:00:00 EAT) - 5 hours prior
      const txTimestamp = parseEthiopianBankTimestamp('2026-09-16 10:00:00');

      const passed = gate.assertRecency(orderCreatedAt, txTimestamp, { minutesBefore: 120, minutesAfter: 120 });
      expect(passed).toBe(false);
    });

    it('correctly rejects a forged receipt timestamp 4 hours in the future', () => {
      // Order created at 12:00:00 UTC
      const orderCreatedAt = new Date('2026-09-16T12:00:00.000Z');
      // Bank receipt claiming 19:00:00 EAT (16:00:00 UTC) - 4 hours future
      const txTimestamp = parseEthiopianBankTimestamp('2026-09-16 19:00:00');

      const passed = gate.assertRecency(orderCreatedAt, txTimestamp, { minutesBefore: 120, minutesAfter: 120 });
      expect(passed).toBe(false);
    });
  });
});
