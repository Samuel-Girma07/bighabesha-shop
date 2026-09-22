import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createOrder, submitReceipt, approveReceipt, getOrderById } from '../src/services/orders.service.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { getLatestEvidenceForOrder, checkAntiReplay } from '../src/db/receipt_evidence.dao.js';
import { ReceiptAlreadyUsedError } from '../src/services/receipt_verifier/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

describe('Phase 3: Anti-Replay Protection on Manual Admin Approvals', () => {
  beforeEach(() => {
    initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('records matched=1 in receipt_evidence upon manual admin approval', () => {
    const order1 = createOrder({
      userId: 1001,
      username: 'buyer1',
      productId: 'gemini_pro_18m',
      amountETB: 1500,
      paymentRail: 'cbe',
    });

    submitReceipt(order1.id, 'receipt_photo_1001.jpg', 'CBE Ref: FT26MANUALTEST1');

    const approval = approveReceipt(order1.id, 999, { reference: 'FT26MANUALTEST1', bank: 'cbe' });
    expect(['fulfilled', 'pending_fulfillment']).toContain(approval.order.status);

    // Verify receipt_evidence row has matched = 1 and normalized_reference
    const db = getDatabase();
    const evidence = getLatestEvidenceForOrder(order1.id, db);
    expect(evidence).not.toBeNull();
    expect(evidence?.matched).toBe(1);
    expect(evidence?.normalized_reference).toBe('FT26MANUALTEST1');
    expect(evidence?.status).toBe('auto_verified');
    expect(evidence?.security_gate_passed).toBe(1);
  });

  it('blocks re-use of manually approved receipt reference by a second order', () => {
    const order1 = createOrder({
      userId: 1002,
      username: 'buyer2',
      productId: 'gemini_pro_18m',
      amountETB: 1500,
      paymentRail: 'cbe',
    });

    approveReceipt(order1.id, 999, { reference: 'FT26SHAREDREF99', bank: 'cbe' });

    // Buyer 2 creates a new order and tries to submit the same receipt reference
    const order2 = createOrder({
      userId: 1003,
      username: 'buyer3',
      productId: 'gemini_pro_18m',
      amountETB: 1500,
      paymentRail: 'cbe',
    });

    // 1. checkAntiReplay immediately catches the replay
    const replayCheck = checkAntiReplay('cbe', 'FT26SHAREDREF99', order2.id);
    expect(replayCheck.isReplay).toBe(true);
    expect(replayCheck.existingOrderId).toBe(order1.id);

    // 2. Admin manual approval of second order with the same reference throws ReceiptAlreadyUsedError
    expect(() => {
      approveReceipt(order2.id, 999, { reference: 'FT26SHAREDREF99', bank: 'cbe' });
    }).toThrow(ReceiptAlreadyUsedError);

    // Verify order2 remains in awaiting_payment / pending_approval
    const currentOrder2 = getOrderById(order2.id);
    expect(currentOrder2?.status).toBe('awaiting_payment');
  });

  it('detects duplicate file_hash on manual approval when evidence has file_hash', () => {
    const db = getDatabase();
    const order1 = createOrder({
      userId: 1004,
      username: 'buyer4',
      productId: 'gemini_pro_18m',
      amountETB: 1500,
      paymentRail: 'cbe',
    });

    // Insert evidence with a unique file_hash
    const hash = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    db.prepare(`
      INSERT INTO receipt_evidence (order_id, user_id, bank, source, file_hash, amount_etb, status)
      VALUES (?, ?, 'cbe', 'telegram_photo', ?, 1500, 'pending_manual_review')
    `).run(order1.id, 1004, hash);

    approveReceipt(order1.id, 999);

    // Order 2 uploads identical receipt file resulting in same hash
    const order2 = createOrder({
      userId: 1005,
      username: 'buyer5',
      productId: 'gemini_pro_18m',
      amountETB: 1500,
      paymentRail: 'cbe',
    });

    db.prepare(`
      INSERT INTO receipt_evidence (order_id, user_id, bank, source, file_hash, amount_etb, status)
      VALUES (?, ?, 'cbe', 'telegram_photo', ?, 1500, 'pending_manual_review')
    `).run(order2.id, 1005, hash);

    // Attempting to approve order2 must throw ReceiptAlreadyUsedError due to duplicate file_hash
    expect(() => {
      approveReceipt(order2.id, 999);
    }).toThrow(ReceiptAlreadyUsedError);
  });

  it('persists contract-complete pillar evaluations (expected/actual) on manual approval', () => {
    const db = getDatabase();

    // Path A: no receipt_evidence row exists → pure manual admin entry INSERT branch
    const orderA = createOrder({
      userId: 1006,
      username: 'buyer6',
      productId: 'gemini_pro_18m',
      amountETB: 1500,
      paymentRail: 'cbe',
    });
    approveReceipt(orderA.id, 999, { reference: 'FT26MANUALJSONA' });

    // Path B: an evidence row exists → markEvidenceMatchedInTx branch
    const orderB = createOrder({
      userId: 1007,
      username: 'buyer7',
      productId: 'gemini_pro_18m',
      amountETB: 1500,
      paymentRail: 'cbe',
    });
    submitReceipt(orderB.id, 'receipt_photo_1007.jpg', 'CBE Ref: FT26MANUALJSONB');
    approveReceipt(orderB.id, 999, { reference: 'FT26MANUALJSONB' });

    for (const orderId of [orderA.id, orderB.id]) {
      const row = db
        .prepare('SELECT security_gate_evaluations AS evals, matched, status FROM receipt_evidence WHERE order_id = ?')
        .get(orderId) as { evals: string; matched: number; status: string } | undefined;

      expect(row).toBeTruthy();
      expect(row?.matched).toBe(1);
      expect(row?.status).toBe('auto_verified');

      const evals = JSON.parse(row!.evals) as Array<{
        pillar: string;
        passed: boolean;
        expected?: unknown;
        actual?: unknown;
        details?: string;
      }>;

      expect(evals).toHaveLength(4);
      expect(evals.map((e) => e.pillar)).toEqual([
        'anti_replay',
        'beneficiary_whitelist',
        'exact_amount',
        'recency_window',
      ]);

      // SecurityPillarEvaluation requires both fields — they must be persisted, not undefined.
      for (const evaluation of evals) {
        expect(evaluation.passed).toBe(true);
        expect(evaluation.expected).toBeDefined();
        expect(evaluation.actual).toBeDefined();
        expect(evaluation.details).toBeTruthy();
      }
    }
  });
});
