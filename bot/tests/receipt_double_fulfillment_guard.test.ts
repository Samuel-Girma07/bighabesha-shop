import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createOrder,
  updateOrderStatus,
  getOrderById,
  submitReceipt,
  approveReceipt,
} from '../src/services/orders.service.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { hasMatchedEvidenceForOrder, markEvidenceMatchedInTx, insertReceiptEvidence } from '../src/db/receipt_evidence.dao.js';
import { getReceiptOrchestrator } from '../src/services/receipt_verifier/index.js';
import { AUTO_FULFILLABLE_ORDER_STATUSES } from '../src/services/receipt_verifier/orchestrator.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

/**
 * P1 regression guard against double fulfillment.
 *
 * Two independent holes let a second fulfillment run against an order that had
 * already been paid:
 *
 *  1. The success path had no `order.status` check at all (only the fallback
 *     path did), so any order in any state could reach `executeFulfillmentTx`.
 *  2. Anti-replay is per-REFERENCE. `checkAntiReplay` deliberately excludes the
 *     current order, so two *different* valid bank references on one order both
 *     passed the anti-replay pillar, and `allocateStock` overwrote
 *     `fulfillment_payload` on the second run.
 */

function makeOrder(userId: number, username: string) {
  return createOrder({
    userId,
    username,
    productId: 'gemini_pro_18m',
    amountETB: 1500,
    paymentRail: 'cbe',
  });
}

/** Marks an order as already matched to a confirmed transaction (matched = 1). */
function confirmOrder(orderId: string, reference: string): void {
  submitReceipt(orderId, `receipt_${reference}.jpg`, reference);
  approveReceipt(orderId, 999, { reference, bank: 'cbe' });
}

describe('FIX-2: fulfillment eligibility guards', () => {
  beforeEach(() => {
    initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('auto-fulfillable status set', () => {
    it('permits awaiting_payment and pending_approval', () => {
      // pending_approval is the ORDINARY resting state after a failed attempt
      // (handleFallback moves awaiting_payment orders there), so excluding it
      // would make it impossible to submit a corrected receipt.
      expect(AUTO_FULFILLABLE_ORDER_STATUSES.has('awaiting_payment')).toBe(true);
      expect(AUTO_FULFILLABLE_ORDER_STATUSES.has('pending_approval')).toBe(true);
    });

    it('refuses every already-fulfilled or terminal state', () => {
      for (const status of [
        'new',
        'pending_fulfillment',
        'processing',
        'fulfilled',
        'delivery_failed',
        'cancelled',
        'refunded',
        'rejected',
      ]) {
        expect(AUTO_FULFILLABLE_ORDER_STATUSES.has(status)).toBe(false);
      }
    });
  });

  describe('per-order replay guard (DAO)', () => {
    it('reports no match for an order with no confirmed transaction', () => {
      const order = makeOrder(2001, 'buyer_replay_1');
      expect(hasMatchedEvidenceForOrder(order.id)).toBe(false);
    });

    it('reports a match once evidence is marked confirmed', () => {
      const order = makeOrder(2002, 'buyer_replay_2');
      confirmOrder(order.id, 'FT26REPLAYGUARD2');
      expect(hasMatchedEvidenceForOrder(order.id)).toBe(true);
    });

    it('does not treat another order\'s confirmed evidence as this order\'s', () => {
      const first = makeOrder(2003, 'buyer_replay_3');
      const second = makeOrder(2004, 'buyer_replay_4');

      confirmOrder(first.id, 'FT26REPLAYGUARD3');

      expect(hasMatchedEvidenceForOrder(first.id)).toBe(true);
      expect(hasMatchedEvidenceForOrder(second.id)).toBe(false);
    });
  });

  describe('orchestrator guard behaviour', () => {
    it('refuses an already-fulfilled order and names the reason', async () => {
      const order = makeOrder(3001, 'buyer_fulfilled');
      updateOrderStatus(order.id, 'fulfilled');

      const orchestrator = getReceiptOrchestrator();
      const result = await orchestrator.processSubmission({
        orderId: order.id,
        userId: order.user_id,
        source: 'webapp_upload',
        directReference: 'FT26FULFILLED001',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ORDER_NOT_FULFILLABLE');
      expect(result.needsAdminReview).toBe(true);

      // The order must not have been dragged back into the review queue.
      expect(getOrderById(order.id)?.status).toBe('fulfilled');
    });

    it('refuses a cancelled order', async () => {
      const order = makeOrder(3002, 'buyer_cancelled');
      updateOrderStatus(order.id, 'cancelled');

      const orchestrator = getReceiptOrchestrator();
      const result = await orchestrator.processSubmission({
        orderId: order.id,
        userId: order.user_id,
        source: 'webapp_upload',
        directReference: 'FT26CANCELLED001',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ORDER_NOT_FULFILLABLE');
    });

    it('refuses a second verification of an already-confirmed order', async () => {
      const order = makeOrder(3003, 'buyer_confirmed');

      // Mark this order's evidence as confirmed while leaving the order itself
      // in `awaiting_payment`. That isolates the replay guard: the status guard
      // cannot be what rejects this submission, only the per-order check.
      const evidence = insertReceiptEvidence({
        orderId: order.id,
        userId: order.user_id,
        bank: 'cbe',
        source: 'webapp_upload',
        amountEtb: 1500,
        reference: 'FT26CONFIRMED01',
        status: 'pending_manual_review',
      });
      markEvidenceMatchedInTx(getDatabase(), {
        evidenceId: evidence.id,
        bank: 'cbe',
        reference: 'FT26CONFIRMED01',
        normalizedReference: 'FT26CONFIRMED01',
        verifiedAmountEtb: 1500,
        beneficiaryAccount: '1000123456789',
        securityGateEvaluations: [],
        rawBankPayload: {},
      });

      expect(hasMatchedEvidenceForOrder(order.id)).toBe(true);
      expect(getOrderById(order.id)?.status).toBe('awaiting_payment');

      const orchestrator = getReceiptOrchestrator();
      // A DIFFERENT reference — precisely the case the per-reference anti-replay
      // pillar cannot see.
      const result = await orchestrator.processSubmission({
        orderId: order.id,
        userId: order.user_id,
        source: 'webapp_upload',
        directReference: 'FT26DIFFERENT9',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ORDER_NOT_FULFILLABLE');
    });
  });
});