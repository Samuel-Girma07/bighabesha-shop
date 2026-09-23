import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { createOrder, getOrderById } from '../src/services/orders.service.js';
import { setPendingAction, getPendingAction, clearPendingAction } from '../src/bot/session.js';
import { handleTextInput, handlePhotoInput, handleDocumentInput } from '../src/bot/handlers/input.js';
import { setReceiptOrchestratorForTest, resetReceiptOrchestrator } from '../src/services/receipt_verifier/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

/**
 * SMS-only receipt intake: buyers send the bank confirmation SMS (or a bare
 * transaction reference) as text. Photos/documents are rejected with guidance.
 * Unreadable text gets up to 3 attempts before the order is routed to the
 * admin manual-review queue (never fails open).
 */
describe('Receipt SMS/Text Intake (SMS-only verification)', () => {
  let db: Database.Database;
  const buyerId = 555123456;

  function makeTextCtx(userId: number, text: string, lang = 'en') {
    const repliedMessages: string[] = [];
    const adminMessages: string[] = [];
    const ctx: any = {
      from: { id: userId, language_code: lang },
      message: { text },
      reply: vi.fn(async (msg: string) => {
        repliedMessages.push(msg);
      }),
      api: {
        sendMessage: vi.fn(async (_chatId: any, msg: string) => {
          adminMessages.push(msg);
          return {};
        }),
        // Admin fallback alerts are delivered as photo captions when a receipt ref is attached
        sendPhoto: vi.fn(async (_chatId: any, _file: any, opts?: any) => {
          adminMessages.push(opts?.caption || '');
          return {};
        }),
        sendDocument: vi.fn(async () => ({})),
      },
    };
    return { ctx, repliedMessages, adminMessages };
  }

  function seedOrder(userId = buyerId) {
    return createOrder({
      userId,
      username: 'receipt_tester',
      productId: 'telegram_premium',
      variantId: 'tg_prem_3m',
      amountETB: 1000,
      paymentRail: 'cbe',
      status: 'awaiting_payment',
    });
  }

  beforeEach(() => {
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = '12345';
    db = initDatabase(':memory:', migrationsDir);

    db.prepare(
      'INSERT INTO users (id, username, first_name, language_code) VALUES (?, ?, ?, ?)'
    ).run(buyerId, 'receipt_tester', 'Receipt Tester', 'en');
  });

  afterEach(() => {
    clearPendingAction(buyerId);
    resetReceiptOrchestrator();
    closeDatabase();
  });


  it('guides the buyer when text contains no transaction reference (attempt 1 of 3, order untouched, no portal call)', async () => {
    const order = seedOrder();

    setPendingAction(buyerId, {
      type: 'user_receipt_upload',
      data: { orderId: order.id, attempts: 0 },
    });

    const { ctx, repliedMessages } = makeTextCtx(buyerId, 'I transferred 1000 ETB already, please verify');
    const handled = await handleTextInput(ctx);
    expect(handled).toBe(true);

    // Order MUST still be awaiting_payment (NOT pending_approval or fulfilled)
    const freshOrder = getOrderById(order.id);
    expect(freshOrder?.status).toBe('awaiting_payment');
    expect(freshOrder?.receipt_file_id).toBeNull();

    // The bot replied with guidance asking for the SMS / reference
    expect(repliedMessages[0]).toContain('Could not find a transaction reference');
    expect(repliedMessages[0]).toContain('Attempt <b>1</b> of <b>3</b>');

    // Pending action remains armed with an incremented attempt counter
    const session = getPendingAction(buyerId);
    expect(session).not.toBeNull();
    expect(session?.type).toBe('user_receipt_upload');
    expect(session?.data?.orderId).toBe(order.id);
    expect(session?.data?.attempts).toBe(1);

    // Verify NO evidence was stored (pre-validation failed before the pipeline ran)
    const evidenceCount = db
      .prepare('SELECT COUNT(*) as c FROM receipt_evidence WHERE order_id = ?')
      .get(order.id) as { c: number };
    expect(evidenceCount.c).toBe(0);
  });

  it('provides Amharic guidance for Amharic users', async () => {
    const amharicBuyerId = 555999888;
    db.prepare(
      'INSERT INTO users (id, username, first_name, language_code) VALUES (?, ?, ?, ?)'
    ).run(amharicBuyerId, 'amharic_tester', 'Amharic Tester', 'am');

    const order = seedOrder(amharicBuyerId);

    setPendingAction(amharicBuyerId, {
      type: 'user_receipt_upload',
      data: { orderId: order.id, attempts: 0 },
    });

    const { ctx, repliedMessages } = makeTextCtx(amharicBuyerId, 'ብር ልኬአለሁ', 'am');
    const handled = await handleTextInput(ctx);
    expect(handled).toBe(true);

    expect(repliedMessages[0]).toContain('የትራንዛክሽን ቁጥር ማግኘት አልተቻለም');
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');

    clearPendingAction(amharicBuyerId);
  });

  it('routes to admin manual review after the 3rd unreadable attempt (never fails open)', async () => {
    const order = seedOrder();

    // Simulate two prior failed attempts
    setPendingAction(buyerId, {
      type: 'user_receipt_upload',
      data: { orderId: order.id, attempts: 2 },
    });

    const { ctx, repliedMessages, adminMessages } = makeTextCtx(buyerId, 'hello I paid, trust me');
    const handled = await handleTextInput(ctx);
    expect(handled).toBe(true);

    // Session cleared (intake locked) and order moved to the manual-review queue
    expect(getPendingAction(buyerId)).toBeFalsy();
    expect(getOrderById(order.id)?.status).toBe('pending_approval');

    // Evidence + audit trail recorded so admins can investigate
    const evidenceCount = db
      .prepare('SELECT COUNT(*) as c FROM receipt_evidence WHERE order_id = ?')
      .get(order.id) as { c: number };
    expect(evidenceCount.c).toBeGreaterThan(0);

    // Buyer informed about manual review and admins notified
    expect(repliedMessages.some((m) => m.toLowerCase().includes('manual review'))).toBe(true);
    expect(adminMessages.length).toBeGreaterThan(0);
  });

  it('allows user to abort receipt upload by typing /cancel', async () => {
    const order = seedOrder();

    setPendingAction(buyerId, {
      type: 'user_receipt_upload',
      data: { orderId: order.id, attempts: 0 },
    });

    const { ctx } = makeTextCtx(buyerId, '/cancel');
    const handled = await handleTextInput(ctx);
    expect(handled).toBe(true);

    // Session is cleared
    expect(getPendingAction(buyerId)).toBeFalsy();

    // Order remains in awaiting_payment
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Receipt upload cancelled'));
  });

  it('rejects photos with SMS-only guidance while keeping the session armed (attempts not consumed)', async () => {
    const order = seedOrder();

    setPendingAction(buyerId, {
      type: 'user_receipt_upload',
      data: { orderId: order.id, attempts: 0 },
    });

    const ctx: any = {
      from: { id: buyerId, language_code: 'en' },
      message: { photo: [{ file_id: 'photo_small' }, { file_id: 'photo_large' }], caption: 'here is my receipt' },
      reply: vi.fn(async () => ({})),
      api: { sendMessage: vi.fn(async () => ({})), sendPhoto: vi.fn(async () => ({})) },
    };

    const handled = await handlePhotoInput(ctx);
    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('no longer accepted'), expect.anything());

    // Order untouched, session still armed, attempts not incremented
    const freshOrder = getOrderById(order.id);
    expect(freshOrder?.status).toBe('awaiting_payment');
    expect(freshOrder?.receipt_file_id).toBeNull();

    const session = getPendingAction(buyerId);
    expect(session?.type).toBe('user_receipt_upload');
    expect(session?.data?.attempts).toBe(0);
  });

  it('rejects documents with SMS-only guidance', async () => {
    const order = seedOrder();

    setPendingAction(buyerId, {
      type: 'user_receipt_upload',
      data: { orderId: order.id, attempts: 0 },
    });

    const ctx: any = {
      from: { id: buyerId, language_code: 'en' },
      message: {
        document: { file_id: 'doc_receipt_pdf', file_name: 'receipt.pdf', mime_type: 'application/pdf' },
        caption: 'CBE receipt',
      },
      reply: vi.fn(async () => ({})),
      api: { sendMessage: vi.fn(async () => ({})), sendDocument: vi.fn(async () => ({})) },
    };

    const handled = await handleDocumentInput(ctx);
    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('no longer accepted'), expect.anything());

    const freshOrder = getOrderById(order.id);
    expect(freshOrder?.status).toBe('awaiting_payment');
    expect(freshOrder?.receipt_file_id).toBeNull();
  });

  it('submits extractable references to the verification pipeline and reports replay detection to the buyer', async () => {
    const order = seedOrder();

    setPendingAction(buyerId, {
      type: 'user_receipt_upload',
      data: { orderId: order.id, attempts: 0 },
    });

    const processSubmission = vi.fn(async () => ({
      success: false,
      status: 'rejected' as const,
      orderId: order.id,
      bank: 'cbe' as const,
      transactionReference: 'FT260904003',
      extractedData: {
        bank: 'cbe' as const,
        rawReference: 'FT260904003',
        normalizedReference: 'FT260904003',
        extractedAt: new Date(),
        confidence: 0.9,
        decodeMethod: 'sms_regex' as const,
      },
      error: {
        type: 'https://example.test/problems/receipt-already-used',
        title: 'Receipt Already Used',
        status: 409,
        detail: 'This transaction reference has already been consumed.',
        instance: '/',
        code: 'RECEIPT_ALREADY_USED',
        timestamp: new Date().toISOString(),
      },
      needsAdminReview: true,
      verifiedAt: new Date(),
      processingDurationMs: 1,
    }));
    setReceiptOrchestratorForTest({ processSubmission } as any);

    const { ctx, repliedMessages, adminMessages } = makeTextCtx(buyerId, 'ETB 1,000.00 debited from your account. Ref: FT260904003');
    const handled = await handleTextInput(ctx);
    expect(handled).toBe(true);

    // The SMS text reached the orchestrator pipeline with the sms_forward source
    expect(processSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: order.id, userId: buyerId, source: 'sms_forward' })
    );

    // Buyer receives the replay warning and the session is cleared
    expect(repliedMessages.some((m) => m.includes('already been used'))).toBe(true);
    expect(getPendingAction(buyerId)).toBeFalsy();

    // Order routed to manual review and admins alerted
    expect(getOrderById(order.id)?.status).toBe('pending_approval');
    expect(adminMessages.length).toBeGreaterThan(0);
  });

  it('delivers the success reply when the portal verifies the SMS reference', async () => {
    const order = seedOrder();

    setPendingAction(buyerId, {
      type: 'user_receipt_upload',
      data: { orderId: order.id, attempts: 0 },
    });

    const processSubmission = vi.fn(async () => ({
      success: true,
      status: 'auto_verified' as const,
      orderId: order.id,
      bank: 'cbe' as const,
      transactionReference: 'FT2609112233',
      extractedData: {
        bank: 'cbe' as const,
        rawReference: 'FT2609112233',
        normalizedReference: 'FT2609112233',
        extractedAt: new Date(),
        confidence: 0.9,
        decodeMethod: 'sms_regex' as const,
      },
      bankPayload: {
        bank: 'cbe' as const,
        transactionReference: 'FT2609112233',
        amountEtb: 1000,
        feeEtb: 0,
        currency: 'ETB',
        beneficiaryAccount: '1000123456789',
        transactionTimestamp: new Date(),
        rawAuditTrail: {},
      },
      needsAdminReview: false,
      verifiedAt: new Date(),
      processingDurationMs: 5,
    }));
    setReceiptOrchestratorForTest({ processSubmission } as any);

    const { ctx, repliedMessages } = makeTextCtx(buyerId, 'FT2609112233');
    const handled = await handleTextInput(ctx);
    expect(handled).toBe(true);

    expect(repliedMessages.some((m) => m.includes('Payment Verified'))).toBe(true);
    expect(getPendingAction(buyerId)).toBeFalsy();
  });
});
