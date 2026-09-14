import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fsp from 'fs/promises';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { getOrderById, updateOrderStatus } from '../src/services/orders.service.js';
import { addStockLink } from '../src/services/stock.service.js';
import { setSetting } from '../src/services/settings.service.js';
import { saveReceiptImage, resolveReceiptsDir } from '../src/services/receipts.service.js';
import {
  ReceiptOrchestrator,
  ReceiptVerificationError,
  setReceiptOrchestratorForTest,
} from '../src/services/receipt_verifier/index.js';
import {
  generateValidQrImage,
  createTestOrderModel,
  FIXTURES,
} from './factories/receipt_data.factory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';

describe('Receipt Re-verification Flow Hardening (Issue 2)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:', migrationsDir);

    // Seed default settings and test configuration
    setSetting('receipt_auto_verify_enabled', '1');
    setSetting('receipt_cbe_beneficiaries', JSON.stringify([FIXTURES.cbe.validAccount]));
    setSetting('receipt_telebirr_beneficiaries', JSON.stringify([FIXTURES.telebirr.validPhone]));
    setSetting('cbe_account', FIXTURES.cbe.validAccount);
    setSetting('receipt_recency_before_mins', '120');
    setSetting('receipt_recency_after_mins', '120');

    // Seed products & stock
    db.prepare(
      `INSERT INTO products (id, type, name, description) VALUES ('gemini_pro', 'stock', 'Gemini Pro 18M', 'Test') ON CONFLICT(id) DO NOTHING`
    ).run();
    addStockLink('gemini_pro', 'https://google.com/activate/REVERIFY_STOCK_001');
  });

  afterEach(() => {
    setReceiptOrchestratorForTest(undefined);
    vi.restoreAllMocks();
    closeDatabase();
  });

  it('re-verifies an order by reloading the saved receipt image from disk when payment_ref is empty', async () => {
    const order = createTestOrderModel(db, {
      userId: 1001,
      amountETB: 1250,
      paymentRail: 'cbe',
      status: 'pending_approval',
    });

    // Generate a valid CBE QR receipt image
    const qrUrl = 'https://apps.cbe.com.et:100/?id=FT_REVERIFY_DISK_001';
    const qrPng = await generateValidQrImage(qrUrl);

    // Save image to disk using receipt service
    const saved = await saveReceiptImage(qrPng.toString('base64'), order.id);

    // Record evidence pointing to the saved file on disk with NO transaction reference
    db.prepare(`
      INSERT INTO receipt_evidence (
        order_id, user_id, bank, source, file_path, mime_type, amount_etb, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(order.id, 1001, 'cbe', 'telegram_photo', saved.filePath, 'image/png', 1250, 'pending_manual_review');

    // Mock upstream CBE bank portal response
    const mockHtml = `
      <html><body>
        <div>Amount: 1,250.00 ETB</div>
        <div>Reference: FT_REVERIFY_DISK_001</div>
        <div>Credited Account: ${FIXTURES.cbe.validAccount}</div>
        <div>Receiver: ${FIXTURES.cbe.beneficiaryName}</div>
        <div>Date: ${new Date().toISOString()}</div>
      </body></html>
    `;
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(mockHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );

    const orchestrator = new ReceiptOrchestrator();
    const result = await orchestrator.reverifyOrder(order.id, 1397163638);

    expect(result.success).toBe(true);
    expect(result.status).toBe('auto_verified');
    expect(result.transactionReference).toBe('FT_REVERIFY_DISK_001');

    // Order should be fulfilled with stock payload allocated
    const updatedOrder = getOrderById(order.id)!;
    expect(updatedOrder.status).toBe('fulfilled');
    expect(updatedOrder.fulfillment_payload).toContain('REVERIFY_STOCK_001');
    expect(updatedOrder.payment_ref).toBe('FT_REVERIFY_DISK_001');

    // Clean up test file
    await fsp.unlink(saved.filePath).catch(() => {});
  });

  it('falls back to stored transaction reference when disk image QR cannot be decoded', async () => {
    const order = createTestOrderModel(db, {
      userId: 1001,
      amountETB: 1250,
      paymentRail: 'cbe',
      status: 'pending_approval',
    });

    // Create a blank image without any QR code
    const blankImg = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();
    const saved = await saveReceiptImage(blankImg.toString('base64'), order.id);

    // Record evidence with saved image path AND a reference code from manual input
    db.prepare(`
      INSERT INTO receipt_evidence (
        order_id, user_id, bank, source, file_path, reference, normalized_reference, mime_type, amount_etb, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order.id,
      1001,
      'cbe',
      'telegram_photo',
      saved.filePath,
      'FT_FALLBACK_REF_002',
      'FT_FALLBACK_REF_002',
      'image/png',
      1250,
      'pending_manual_review'
    );

    // Mock upstream CBE bank portal response for the reference code
    const mockHtml = `
      <html><body>
        <div>Amount: 1,250.00 ETB</div>
        <div>Reference: FT_FALLBACK_REF_002</div>
        <div>Credited Account: ${FIXTURES.cbe.validAccount}</div>
        <div>Receiver: ${FIXTURES.cbe.beneficiaryName}</div>
        <div>Date: ${new Date().toISOString()}</div>
      </body></html>
    `;
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(mockHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );

    const orchestrator = new ReceiptOrchestrator();
    const result = await orchestrator.reverifyOrder(order.id, 1397163638);

    expect(result.success).toBe(true);
    expect(result.status).toBe('auto_verified');
    expect(result.transactionReference).toBe('FT_FALLBACK_REF_002');

    // Clean up test file
    await fsp.unlink(saved.filePath).catch(() => {});
  });

  it('throws a clean Receipt Evidence Unavailable error and NEVER parses admin audit note when no evidence exists', async () => {
    const order = createTestOrderModel(db, {
      userId: 1001,
      amountETB: 1250,
      paymentRail: 'cbe',
      status: 'pending_approval',
    });

    // Ensure order has no payment_ref and no receipt_file_id
    expect(order.payment_ref).toBeNull();
    expect(order.receipt_file_id).toBeNull();

    const orchestrator = new ReceiptOrchestrator();

    try {
      await orchestrator.reverifyOrder(order.id, 1397163638);
      expect.unreachable('Should have thrown ReceiptVerificationError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ReceiptVerificationError);
      expect(err.problemDetails.code).toBe('CORRUPTED_FILE');
      expect(err.problemDetails.title).toBe('Receipt Evidence Unavailable');
      expect(err.problemDetails.detail).toContain(order.id);

      // Must NEVER contain the old bug message
      expect(err.message).not.toContain('Unsupported Banking Rail');
      expect(err.message).not.toContain('Admin 1397163638 requested reverificatio');
    }
  });

  it('strictly blocks admin notes from being parsed as bank receipts in manual_admin_entry', async () => {
    const order = createTestOrderModel(db, {
      userId: 1001,
      amountETB: 1250,
      paymentRail: 'cbe',
      status: 'pending_approval',
    });

    const orchestrator = new ReceiptOrchestrator();

    // Directly test processSubmission with manual_admin_entry and an admin note
    const result = await orchestrator.processSubmission({
      orderId: order.id,
      userId: 1001,
      source: 'manual_admin_entry',
      note: 'Admin 1397163638 requested reverification',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CORRUPTED_FILE');
    expect(result.error?.title).toBe('Missing Receipt Content');
    expect(result.error?.detail).not.toContain('Unsupported Banking Rail');
    expect(result.error?.detail).not.toContain('Admin 1397163638 requested reverificatio');
  });
});
