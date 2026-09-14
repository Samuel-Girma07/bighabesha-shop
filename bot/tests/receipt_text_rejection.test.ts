import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { createOrder, getOrderById } from '../src/services/orders.service.js';
import { setPendingAction, getPendingAction, clearPendingAction } from '../src/bot/session.js';
import { handleTextInput } from '../src/bot/handlers/input.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

describe('Receipt Upload Text Rejection (Issue 3)', () => {
  let db: Database.Database;
  const buyerId = 555123456;

  beforeEach(() => {
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    db = initDatabase(':memory:', migrationsDir);

    db.prepare(
      'INSERT INTO users (id, username, first_name, language_code) VALUES (?, ?, ?, ?)'
    ).run(buyerId, 'receipt_tester', 'Receipt Tester', 'en');
  });

  afterEach(() => {
    clearPendingAction(buyerId);
    closeDatabase();
  });

  it('strictly rejects plain text and does NOT advance order to pending_approval', async () => {
    const order = createOrder({
      userId: buyerId,
      username: 'receipt_tester',
      productId: 'telegram_premium',
      variantId: 'tg_prem_3m',
      amountETB: 1000,
      paymentRail: 'cbe',
      status: 'awaiting_payment',
    });

    setPendingAction(buyerId, {
      type: 'user_receipt_upload',
      data: { orderId: order.id },
    });

    const repliedMessages: string[] = [];
    const mockCtx: any = {
      from: { id: buyerId, language_code: 'en' },
      message: { text: 'I transferred 1000 ETB already, please verify ref #FT2609019999' },
      reply: vi.fn(async (msg: string) => {
        repliedMessages.push(msg);
      }),
    };

    const handled = await handleTextInput(mockCtx);
    expect(handled).toBe(true);

    // Order MUST still be awaiting_payment (NOT pending_approval or fulfilled)
    const freshOrder = getOrderById(order.id);
    expect(freshOrder?.status).toBe('awaiting_payment');
    expect(freshOrder?.receipt_file_id).toBeNull();

    // The bot replied with rejection message instructing user to upload photo/PDF
    expect(mockCtx.reply).toHaveBeenCalled();
    expect(repliedMessages[0]).toContain('Please upload a receipt photo or document (PDF)');

    // Pending action MUST remain armed so user can still upload the photo/document
    const session = getPendingAction(buyerId);
    expect(session).not.toBeNull();
    expect(session?.type).toBe('user_receipt_upload');
    expect(session?.data?.orderId).toBe(order.id);

    // Verify NO fake evidence was stored in receipt_evidence
    const evidenceCount = db
      .prepare('SELECT COUNT(*) as c FROM receipt_evidence WHERE order_id = ?')
      .get(order.id) as { c: number };
    expect(evidenceCount.c).toBe(0);
  });

  it('provides Amharic rejection notice for Amharic users', async () => {
    const amharicBuyerId = 555999888;
    db.prepare(
      'INSERT INTO users (id, username, first_name, language_code) VALUES (?, ?, ?, ?)'
    ).run(amharicBuyerId, 'amharic_tester', 'Amharic Tester', 'am');

    const order = createOrder({
      userId: amharicBuyerId,
      username: 'amharic_tester',
      productId: 'telegram_premium',
      variantId: 'tg_prem_3m',
      amountETB: 1000,
      paymentRail: 'cbe',
      status: 'awaiting_payment',
    });

    setPendingAction(amharicBuyerId, {
      type: 'user_receipt_upload',
      data: { orderId: order.id },
    });

    const repliedMessages: string[] = [];
    const mockCtx: any = {
      from: { id: amharicBuyerId, language_code: 'am' },
      message: { text: 'ብር ልኬአለሁ' },
      reply: vi.fn(async (msg: string) => {
        repliedMessages.push(msg);
      }),
    };

    const handled = await handleTextInput(mockCtx);
    expect(handled).toBe(true);

    expect(repliedMessages[0]).toContain('እባክዎ የደረሰኝ ፎቶ ወይም ዶክመንት (PDF) ይላኩ');

    const freshOrder = getOrderById(order.id);
    expect(freshOrder?.status).toBe('awaiting_payment');
  });

  it('allows user to abort receipt upload by typing /cancel', async () => {
    const order = createOrder({
      userId: buyerId,
      username: 'receipt_tester',
      productId: 'telegram_premium',
      variantId: 'tg_prem_3m',
      amountETB: 1000,
      paymentRail: 'cbe',
      status: 'awaiting_payment',
    });

    setPendingAction(buyerId, {
      type: 'user_receipt_upload',
      data: { orderId: order.id },
    });

    const mockCtx: any = {
      from: { id: buyerId },
      message: { text: '/cancel' },
      reply: vi.fn(),
    };

    const handled = await handleTextInput(mockCtx);
    expect(handled).toBe(true);

    // Session is cleared
    expect(getPendingAction(buyerId)).toBeFalsy();

    // Order remains in awaiting_payment
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
    expect(mockCtx.reply).toHaveBeenCalledWith(expect.stringContaining('Receipt upload cancelled'));
  });
});
