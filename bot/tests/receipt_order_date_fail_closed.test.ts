import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { createOrder } from '../src/services/orders.service.js';
import { parseUtcTimestamp } from '../src/services/receipt_verifier/constants.js';
import { SecurityGateService } from '../src/services/receipt_verifier/security_gate.service.js';
import { getReceiptOrchestrator } from '../src/services/receipt_verifier/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

/**
 * P1 regression guard: `parseUtcTimestamp` anchored the recency window.
 *
 * It returned `new Date()` whenever `order.created_at` was missing or
 * unparseable, which slid the recency window to centre on the present moment.
 * A stale or fabricated receipt then always fell "inside" the window, and the
 * `isNaN(orderDate.getTime())` guard in assertRecency was unreachable for the
 * invalid case. This contradicted the contract stated in the same file:
 * "This MUST NOT fall back to new Date()".
 */

describe('FIX-3: parseUtcTimestamp fails closed', () => {
  describe('parser contract', () => {
    it('returns null for absent values instead of "now"', () => {
      expect(parseUtcTimestamp(null)).toBeNull();
      expect(parseUtcTimestamp(undefined)).toBeNull();
      expect(parseUtcTimestamp('')).toBeNull();
      expect(parseUtcTimestamp('   ')).toBeNull();
    });

    it('returns null for an Invalid Date instance', () => {
      expect(parseUtcTimestamp(new Date('nonsense'))).toBeNull();
    });

    it('returns null for genuinely unparseable strings', () => {
      expect(parseUtcTimestamp('not-a-date')).toBeNull();
      expect(parseUtcTimestamp('0000-00-00 00:00:00')).toBeNull();
    });

    it('never returns the current time for an unparseable input', () => {
      const before = Date.now();
      const result = parseUtcTimestamp('garbage');
      const after = Date.now();

      // The old behaviour returned new Date(), landing inside this window.
      if (result !== null) {
        const t = result.getTime();
        expect(t < before || t > after).toBe(true);
      }
      expect(result).toBeNull();
    });

    it('still parses the formats SQLite actually produces', () => {
      const sqlite = parseUtcTimestamp('2026-09-30 09:56:00');
      expect(sqlite).not.toBeNull();
      expect(sqlite?.toISOString()).toBe('2026-09-30T09:56:00.000Z');

      expect(parseUtcTimestamp('2026-09-30')?.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    });

    it('passes through a valid Date and an explicit-offset string', () => {
      const d = new Date('2026-01-02T03:04:05Z');
      expect(parseUtcTimestamp(d)).toBe(d);
      expect(parseUtcTimestamp('2026-01-02T03:04:05Z')?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    });
  });

  describe('recency pillar fails closed on an unreadable order date', () => {
    const gate = new SecurityGateService();

    it('rejects when the order creation date is null', () => {
      const tx = new Date();
      expect(gate.assertRecency(null, tx)).toBe(false);
    });

    it('rejects when the order creation date is null even for a fresh receipt', () => {
      // The exact attack the old fallback enabled: an unanchored window accepts
      // whatever timestamp the bank reports, however recent.
      expect(gate.assertRecency(null, new Date())).toBe(false);
    });

    it('still accepts a correctly anchored fresh receipt', () => {
      const orderCreated = new Date('2026-09-30T09:56:00Z');
      const tx = new Date(orderCreated.getTime() + 60_000);
      expect(gate.assertRecency(orderCreated, tx)).toBe(true);
    });

    it('still rejects an anchored but stale receipt', () => {
      const orderCreated = new Date('2026-09-30T09:56:00Z');
      const stale = new Date(orderCreated.getTime() + 5 * 60 * 60 * 1000);
      expect(gate.assertRecency(orderCreated, stale)).toBe(false);
    });

    it('does not throw when the order date is unparseable', () => {
      expect(() => gate.assertRecency(null, new Date())).not.toThrow();
    });
  });

  describe('orchestrator routes an unreadable order date to manual review', () => {
    beforeEach(() => {
      initDatabase(':memory:', migrationsDir);
    });

    afterEach(() => {
      closeDatabase();
    });

    it('refuses verification instead of anchoring the window on "now"', async () => {
      const order = createOrder({
        userId: 4001,
        username: 'buyer_bad_date',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'cbe',
      });

      // Corrupt the order's creation timestamp the way a bad migration or a
      // malformed legacy row would.
      getDatabase()
        .prepare("UPDATE orders SET created_at = 'garbage-timestamp' WHERE id = ?")
        .run(order.id);

      expect(parseUtcTimestamp('garbage-timestamp')).toBeNull();

      const orchestrator = getReceiptOrchestrator();
      const result = await orchestrator.processSubmission({
        orderId: order.id,
        userId: order.user_id,
        source: 'webapp_upload',
        directReference: 'FT26BADDATE0001',
      });

      expect(result.success).toBe(false);
      expect(result.needsAdminReview).toBe(true);
      expect(result.error?.code).toBe('RECEIPT_EXPIRED');
      // The message must not pretend the order date was readable.
      expect(result.error?.detail).toMatch(/unreadable order creation time/i);
    });
  });
});