import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { setSetting, getSetting } from '../src/services/settings.service.js';
import { createOrder, getOrderById } from '../src/services/orders.service.js';
import { addStockLink } from '../src/services/stock.service.js';
import { ReceiptOrchestrator, isAutoVerifyEnabled } from '../src/services/receipt_verifier/orchestrator.service.js';
import {
  SYNTHETIC_CBE_TOKEN,
  SYNTHETIC_MASKED_ACCOUNT,
} from './factories/cbe_api_response.factory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
process.env.ADMIN_IDS = process.env.ADMIN_IDS || '111111111';

const BUYER_ID = 1001;

/**
 * A CBE transaction-detail document that satisfies all four security pillars.
 *
 * `amountEtb` is the SETTLED figure. The credited account is masked, exactly as
 * the bank publishes it, so the whitelist comparison in `beforeEach` is
 * configured in the same masked form.
 */
function cbeConfirmationResponse(amountEtb: string = '1250.00'): Response {
  return new Response(
    JSON.stringify({
      id: 'TXR4K9Z7Q2WX',
      status: 'COMPLETED',
      amountCredited: amountEtb,
      amountDebited: amountEtb,
      totalChargeAmount: '0.00',
      totalTaxAmount: '0.00',
      creditAccountNo: SYNTHETIC_MASKED_ACCOUNT,
      creditAccountHolder: 'Bighabesha Shop',
      dateTimes: [new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

describe('Automated verification kill-switch (receipt_auto_verify_enabled)', () => {
  let db: Database.Database;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = initDatabase(':memory:', migrationsDir);

    setSetting('receipt_cbe_beneficiaries', JSON.stringify([SYNTHETIC_MASKED_ACCOUNT]));
    setSetting('cbe_account', SYNTHETIC_MASKED_ACCOUNT);

    db.prepare(`INSERT INTO users (id, username, first_name) VALUES (${BUYER_ID}, 'buyer', 'Buyer')`).run();
    db.prepare(
      `INSERT INTO products (id, type, name, description) VALUES ('gemini_pro', 'stock', 'Gemini Pro 18M', 'Test')
       ON CONFLICT(id) DO NOTHING`
    ).run();
    addStockLink('gemini_pro', 'https://google.com/activate/TEST_CODE_001');

    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    closeDatabase();
  });

  // ==========================================================================
  // Default posture
  // ==========================================================================

  it('ships enabled by default when configured', () => {
    // No setSetting() call: this asserts the value migrations + seed actually leave behind.
    expect(getSetting('receipt_auto_verify_enabled')).toBe('1');
    expect(isAutoVerifyEnabled()).toBe(true);
  });

  it('treats missing, empty and unparseable values as disabled (fail-safe)', () => {
    db.prepare(`DELETE FROM settings WHERE key = 'receipt_auto_verify_enabled'`).run();
    expect(isAutoVerifyEnabled()).toBe(false);

    setSetting('receipt_auto_verify_enabled', '');
    expect(isAutoVerifyEnabled()).toBe(false);

    // A garbage value must never be interpreted as "on".
    setSetting('receipt_auto_verify_enabled', 'maybe');
    expect(isAutoVerifyEnabled()).toBe(false);
  });

  // ==========================================================================
  // Disabled behaviour
  // ==========================================================================

  it('routes every submission to administrator review without contacting a bank portal', async () => {
    const order = createOrder({
      userId: BUYER_ID,
      productId: 'gemini_pro',
      amountETB: 1250,
      paymentRail: 'cbe',
    });

    const orchestrator = new ReceiptOrchestrator();
    const result = await orchestrator.processSubmission({
      orderId: order.id,
      userId: BUYER_ID,
      source: 'sms_forward',
      directReference: 'FT_KILLSWITCH_001',
    });

    // The critical assertion: not a single outbound request was attempted.
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(result.success).toBe(false);
    expect(result.status).toBe('pending_manual_review');
    expect(result.needsAdminReview).toBe(true);
    expect(result.error?.code).toBe('AUTO_VERIFY_DISABLED');

    // The buyer's money is never lost: the order is queued, not cancelled.
    expect(getOrderById(order.id)?.status).toBe('pending_approval');

    // The attempt is still fully auditable.
    const evidence = db
      .prepare('SELECT COUNT(*) AS c FROM receipt_evidence WHERE order_id = ?')
      .get(order.id) as { c: number };
    expect(evidence.c).toBeGreaterThan(0);
  });

  it('does not allocate stock or deliver while disabled', async () => {
    const order = createOrder({
      userId: BUYER_ID,
      productId: 'gemini_pro',
      amountETB: 1250,
      paymentRail: 'cbe',
    });

    await new ReceiptOrchestrator().processSubmission({
      orderId: order.id,
      userId: BUYER_ID,
      source: 'sms_forward',
      directReference: 'FT_KILLSWITCH_002',
    });

    const updated = getOrderById(order.id)!;
    expect(updated.fulfillment_payload).toBeFalsy();
    expect(updated.status).not.toBe('fulfilled');

    // The stock link must still be available for a later approval.
    const remaining = db
      .prepare(`SELECT COUNT(*) AS c FROM stock_items WHERE product_id = 'gemini_pro' AND status = 'available'`)
      .get() as { c: number };
    expect(remaining.c).toBe(1);
  });

  // ==========================================================================
  // Enabled behaviour + live toggling
  // ==========================================================================

  it('reaches the bank adapter once the operator enables it', async () => {
    setSetting('receipt_auto_verify_enabled', '1');
    expect(isAutoVerifyEnabled()).toBe(true);

    const order = createOrder({
      userId: BUYER_ID,
      productId: 'gemini_pro',
      amountETB: 1250,
      paymentRail: 'cbe',
    });

    fetchSpy.mockResolvedValueOnce(cbeConfirmationResponse('1250.00'));

    const result = await new ReceiptOrchestrator().processSubmission({
      orderId: order.id,
      userId: BUYER_ID,
      source: 'sms_forward',
      directReference: SYNTHETIC_CBE_TOKEN,
    });

    expect(fetchSpy).toHaveBeenCalled();
    // Proves the kill-switch was the only thing blocking the pipeline, not a broken adapter.
    expect(result.error?.code).not.toBe('AUTO_VERIFY_DISABLED');
    expect(result.success).toBe(true);
    expect(result.status).toBe('auto_verified');
    expect(getOrderById(order.id)?.status).toBe('fulfilled');
  });

  it('honours a runtime toggle on the same orchestrator instance with no restart', async () => {
    const orchestrator = new ReceiptOrchestrator();

    const blocked = createOrder({
      userId: BUYER_ID,
      productId: 'gemini_pro',
      amountETB: 1250,
      paymentRail: 'cbe',
    });
    const blockedResult = await orchestrator.processSubmission({
      orderId: blocked.id,
      userId: BUYER_ID,
      source: 'sms_forward',
      directReference: 'FT_TOGGLE_001',
    });
    expect(blockedResult.error?.code).toBe('AUTO_VERIFY_DISABLED');
    expect(fetchSpy).not.toHaveBeenCalled();

    // An administrator flips the switch from the dashboard mid-flight.
    setSetting('receipt_auto_verify_enabled', '1');

    const allowed = createOrder({
      userId: BUYER_ID,
      productId: 'gemini_pro',
      amountETB: 1250,
      paymentRail: 'cbe',
    });
    fetchSpy.mockResolvedValueOnce(cbeConfirmationResponse('1250.00'));

    const allowedResult = await orchestrator.processSubmission({
      orderId: allowed.id,
      userId: BUYER_ID,
      source: 'sms_forward',
      directReference: SYNTHETIC_CBE_TOKEN,
    });

    expect(allowedResult.error?.code).not.toBe('AUTO_VERIFY_DISABLED');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
