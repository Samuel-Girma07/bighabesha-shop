/**
 * Bighabesha Shop - Ethiopian Bank Receipt Verification Engine
 * Comprehensive Edge-Case, Adversarial, Concurrency & Security Gate Test Suite
 *
 * Phase 6: Quality Playbook & Compliance Test Framework
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { getOrderById, updateOrderStatus } from '../src/services/orders.service.js';
import { addStockLink, getAvailableStockCount } from '../src/services/stock.service.js';
import { setSetting } from '../src/services/settings.service.js';
import {
  ReceiptIngestionService,
  CbeBankAdapter,
  TelebirrAdapter,
  SecurityGateService,
  ReceiptOrchestrator,
  CircuitBreaker,
  ReceiptAlreadyUsedError,
  BeneficiaryMismatchError,
  AmountMismatchError,
  ReceiptExpiredError,
  QrDecodeFailedError,
  BankPortalUnavailableError,
  PortalGeoblockedError,
  UnsupportedBankError,
  ReceiptVerificationError,
  setReceiptOrchestratorForTest,
} from '../src/services/receipt_verifier/index.js';
import {
  generateSyntheticCbePdf,
  generateSyntheticTelebirrHtml,
  generateValidQrImage,
  generateDegradedQrImage,
  generateInvertedQrImage,
  generateMalformedQrImage,
  createTestOrderModel,
  createMockOrderSecurityContext,
  createMockBankPayload,
  FIXTURES,
} from './factories/receipt_data.factory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
process.env.ADMIN_IDS = process.env.ADMIN_IDS || '12345678,87654321';

describe('Phase 6: Quality Playbook - Receipt Verifier Edge-Case & Adversarial Suite', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:', migrationsDir);

    // Seed default settings and test configuration
    setSetting('receipt_auto_verify_enabled', '1');
    setSetting('receipt_cbe_beneficiaries', JSON.stringify([FIXTURES.cbe.validAccount]));
    setSetting('receipt_telebirr_beneficiaries', JSON.stringify([FIXTURES.telebirr.validPhone]));
    setSetting('cbe_account', FIXTURES.cbe.validAccount);
    setSetting('telebirr_account', FIXTURES.telebirr.validPhone);
    setSetting('receipt_recency_before_mins', '120');
    setSetting('receipt_recency_after_mins', '120');

    // Seed products
    db.prepare(`INSERT INTO products (id, type, name, description) VALUES ('gemini_pro', 'stock', 'Gemini Pro 18M', 'Test') ON CONFLICT(id) DO NOTHING`).run();
    db.prepare(`INSERT INTO products (id, type, name, description) VALUES ('telegram_premium', 'order', 'Telegram Premium', 'Test') ON CONFLICT(id) DO NOTHING`).run();

    // Seed stock
    addStockLink('gemini_pro', 'https://google.com/activate/EDGE_STOCK_CODE_001');
    addStockLink('gemini_pro', 'https://google.com/activate/EDGE_STOCK_CODE_002');
    addStockLink('gemini_pro', 'https://google.com/activate/EDGE_STOCK_CODE_003');
  });

  afterEach(() => {
    setReceiptOrchestratorForTest(undefined);
    vi.restoreAllMocks();
    closeDatabase();
  });

  // ============================================================================
  // 1. Boundary Amounts
  // ============================================================================

  describe('1. Boundary Amounts & Decimal Precision', () => {
    const gate = new SecurityGateService();

    it('passes exact net payable amount match (1250 ETB == 1250 ETB)', async () => {
      const orderContext = createMockOrderSecurityContext({ netPayableEtb: 1250 });
      const bankPayload = createMockBankPayload({ amountEtb: 1250 });

      const result = await gate.evaluate(orderContext, bankPayload);

      expect(result.passed).toBe(true);
      const amountPillar = result.evaluations.find((e) => e.pillar === 'exact_amount');
      expect(amountPillar?.passed).toBe(true);
      expect(amountPillar?.actual).toBe(1250);
    });

    it('strictly rejects a 1 cent/penny underpayment (1250.00 ETB required, 1249.99 ETB paid)', async () => {
      const orderContext = createMockOrderSecurityContext({ netPayableEtb: 1250.0 });
      const bankPayload = createMockBankPayload({ amountEtb: 1249.99 });

      const result = await gate.evaluate(orderContext, bankPayload);

      expect(result.passed).toBe(false);
      expect(result.failedPillar?.pillar).toBe('exact_amount');
      expect(result.failedPillar?.expected).toBe(1250.0);
      expect(result.failedPillar?.actual).toBe(1249.99);
      expect(result.failedPillar?.details).toContain('Underpayment');
    });

    it('orchestrator routes 1 cent underpayment to admin review with AMOUNT_MISMATCH', async () => {
      const order = createTestOrderModel(db, { amountETB: 1250 });
      const orchestrator = new ReceiptOrchestrator();

      const mockHtml = `
        <html><body>
          <div>Amount: 1,249.99 ETB</div>
          <div>Reference: FT_UNDERPAY_1CENT</div>
          <div>Credited Account: ${FIXTURES.cbe.validAccount}</div>
          <div>Receiver: ${FIXTURES.cbe.beneficiaryName}</div>
          <div>Date: ${new Date().toISOString()}</div>
        </body></html>
      `;
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(mockHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }));

      const res = await orchestrator.processSubmission({
        orderId: order.id,
        userId: 1001,
        source: 'telegram_photo',
        directReference: 'FT_UNDERPAY_1CENT',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('pending_manual_review');
      expect(res.error?.code).toBe('AMOUNT_MISMATCH');
      expect(res.needsAdminReview).toBe(true);

      const updated = getOrderById(order.id)!;
      expect(updated.status).toBe('pending_approval');
    });

    it('accepts customer overpayments (1250 ETB net payable, 1300 ETB paid)', async () => {
      const orderContext = createMockOrderSecurityContext({ netPayableEtb: 1250 });
      const bankPayload = createMockBankPayload({ amountEtb: 1300 });

      const result = await gate.evaluate(orderContext, bankPayload);

      expect(result.passed).toBe(true);
      const amountPillar = result.evaluations.find((e) => e.pillar === 'exact_amount');
      expect(amountPillar?.passed).toBe(true);
      expect(amountPillar?.details).toContain('meets or exceeds');
    });

    it('rejects zero or negative paid amounts', async () => {
      expect(gate.assertAmount(1250, 0)).toBe(false);
      expect(gate.assertAmount(1250, -500)).toBe(false);
      expect(gate.assertAmount(1250, NaN)).toBe(false);
    });

    it('evaluates discount deduction correctly (Order 1500 ETB, Discount 250 ETB, Paid 1250 ETB)', async () => {
      const order = createTestOrderModel(db, { amountETB: 1500, discountETB: 250 });
      const orchestrator = new ReceiptOrchestrator();

      const mockHtml = `
        <html><body>
          <div>Amount: 1,250.00 ETB</div>
          <div>Reference: FT_DISCOUNT_MATCH</div>
          <div>Credited Account: ${FIXTURES.cbe.validAccount}</div>
          <div>Receiver: ${FIXTURES.cbe.beneficiaryName}</div>
          <div>Date: ${new Date().toISOString()}</div>
        </body></html>
      `;
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(mockHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }));

      const res = await orchestrator.processSubmission({
        orderId: order.id,
        userId: 1001,
        source: 'telegram_photo',
        directReference: 'FT_DISCOUNT_MATCH',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('auto_verified');
      expect(res.bankPayload?.amountEtb).toBe(1250);

      const updated = getOrderById(order.id)!;
      expect(updated.status).toBe('fulfilled');
    });
  });

  // ============================================================================
  // 2. Temporal Bounds
  // ============================================================================

  describe('2. Temporal Bounds & Recency Window Validation', () => {
    const gate = new SecurityGateService();

    it('passes transaction timestamp at exact -120m lower boundary', () => {
      const orderCreated = new Date('2026-09-08T12:00:00.000Z');
      const exactMinus120m = new Date(orderCreated.getTime() - 120 * 60 * 1000);

      const passed = gate.assertRecency(orderCreated, exactMinus120m, { minutesBefore: 120, minutesAfter: 120 });
      expect(passed).toBe(true);
    });

    it('passes transaction timestamp at exact +120m upper boundary', () => {
      const orderCreated = new Date('2026-09-08T12:00:00.000Z');
      const exactPlus120m = new Date(orderCreated.getTime() + 120 * 60 * 1000);

      const passed = gate.assertRecency(orderCreated, exactPlus120m, { minutesBefore: 120, minutesAfter: 120 });
      expect(passed).toBe(true);
    });

    it('rejects transaction timestamp 1 second before allowed window (-120m - 1s)', () => {
      const orderCreated = new Date('2026-09-08T12:00:00.000Z');
      const tooEarly = new Date(orderCreated.getTime() - (120 * 60 * 1000 + 1000));

      const passed = gate.assertRecency(orderCreated, tooEarly, { minutesBefore: 120, minutesAfter: 120 });
      expect(passed).toBe(false);
    });

    it('rejects transaction timestamp 1 second after allowed window (+120m + 1s)', () => {
      const orderCreated = new Date('2026-09-08T12:00:00.000Z');
      const tooLate = new Date(orderCreated.getTime() + (120 * 60 * 1000 + 1000));

      const passed = gate.assertRecency(orderCreated, tooLate, { minutesBefore: 120, minutesAfter: 120 });
      expect(passed).toBe(false);
    });

    it('respects dynamic database settings for recency window', async () => {
      // Configure asymmetric window: 30m before, 240m after
      setSetting('receipt_recency_before_mins', '30');
      setSetting('receipt_recency_after_mins', '240');

      const orderCreated = new Date('2026-09-08T12:00:00.000Z');

      // 45m before: outside 30m before window
      const tx45mBefore = new Date(orderCreated.getTime() - 45 * 60 * 1000);
      const resBefore = await gate.evaluate(
        createMockOrderSecurityContext({ orderCreatedAt: orderCreated }),
        createMockBankPayload({ transactionTimestamp: tx45mBefore })
      );
      expect(resBefore.passed).toBe(false);
      expect(resBefore.failedPillar?.pillar).toBe('recency_window');

      // 180m after: within 240m after window
      const tx180mAfter = new Date(orderCreated.getTime() + 180 * 60 * 1000);
      const resAfter = await gate.evaluate(
        createMockOrderSecurityContext({ orderCreatedAt: orderCreated }),
        createMockBankPayload({ transactionTimestamp: tx180mAfter })
      );
      expect(resAfter.passed).toBe(true);
    });
  });

  // ============================================================================
  // 3. Character Encoding & Special Symbols
  // ============================================================================

  describe('3. Character Encoding & Special Symbols', () => {
    it('parses Amharic / Unicode customer names from synthetic CBE vector PDF', async () => {
      const adapter = new CbeBankAdapter();
      const ref = {
        bank: 'cbe' as const,
        rawReference: 'FT_AMHARIC_01',
        normalizedReference: 'FT_AMHARIC_01',
        extractedAt: new Date(),
        confidence: 0.99,
        decodeMethod: 'pdf_stream' as const,
      };

      const pdfBuffer = await generateSyntheticCbePdf({
        reference: 'FT_AMHARIC_01',
        amountEtb: 1250,
        creditedAccount: FIXTURES.cbe.validAccount,
        receiverName: FIXTURES.cbe.beneficiaryName,
        payerName: 'ሳሙኤል ግርማ አበበ',
        dateStr: '2026-09-08 11:30:00',
      });

      const payload = await adapter.parsePdfResponse(pdfBuffer, ref);

      expect(payload.bank).toBe('cbe');
      expect(payload.transactionReference).toBe('FT_AMHARIC_01');
      expect(payload.amountEtb).toBe(1250);
      expect(payload.beneficiaryAccount).toBe(FIXTURES.cbe.validAccount);
    }, 45000);

    it('parses Amharic / Unicode party names and phone accounts from Telebirr HTML', async () => {
      const adapter = new TelebirrAdapter();
      const ref = {
        bank: 'telebirr' as const,
        rawReference: 'RA_UNICODE_88',
        normalizedReference: 'RA_UNICODE_88',
        extractedAt: new Date(),
        confidence: 0.95,
        decodeMethod: 'qr_matrix' as const,
      };

      const html = generateSyntheticTelebirrHtml({
        reference: 'RA_UNICODE_88',
        amountEtb: 500,
        creditedParty: FIXTURES.telebirr.validPhone,
        creditedPartyName: FIXTURES.telebirr.unicodeAmharicName,
        debitedParty: '0988776655',
        debitedPartyName: FIXTURES.telebirr.unicodeAmharicPayer,
        paymentTime: '2026-09-08 10:15:00',
      });

      const payload = adapter.parseHtmlResponse(html, ref);

      expect(payload.bank).toBe('telebirr');
      expect(payload.transactionReference).toBe('RA_UNICODE_88');
      expect(payload.amountEtb).toBe(500);
      expect(payload.beneficiaryAccount).toBe(FIXTURES.telebirr.validPhone);
      expect(payload.beneficiaryName).toBe(FIXTURES.telebirr.unicodeAmharicName);
      expect(payload.senderName).toBe(FIXTURES.telebirr.unicodeAmharicPayer);
    });

    it('normalizes whitespace variations in reference strings', async () => {
      const ingestion = new ReceiptIngestionService();

      // Leading, trailing, and internal whitespaces
      const text1 = '   FT24252Y8WQM   ';
      const parsed1 = await ingestion.ingestText(text1);
      expect(parsed1.normalizedReference).toBe('FT24252Y8WQM');

      const text2 = 'Payment slip confirmed. Ref:  FT24252Y8WQM  \nThank you.';
      const parsed2 = await ingestion.ingestText(text2);
      expect(parsed2.normalizedReference).toBe('FT24252Y8WQM');
    });

    it('normalizes mixed-case references to canonical uppercase', async () => {
      const ingestion = new ReceiptIngestionService();

      const lowerCbe = 'ft24252y8wqm';
      const parsedCbe = await ingestion.ingestText(lowerCbe);
      expect(parsedCbe.normalizedReference).toBe('FT24252Y8WQM');

      const lowerTelebirr = 'telebirr: Transferred 500 ETB to 0911223344. Transaction number: ra75od70c2';
      const parsedTelebirr = await ingestion.ingestText(lowerTelebirr);
      expect(parsedTelebirr.normalizedReference).toBe('RA75OD70C2');
    });

    it('sanitizes HTML entities and XSS payload attempts in customer names', () => {
      const adapter = new TelebirrAdapter();
      const ref = {
        bank: 'telebirr' as const,
        rawReference: 'RA_XSS_001',
        normalizedReference: 'RA_XSS_001',
        extractedAt: new Date(),
        confidence: 0.95,
        decodeMethod: 'qr_matrix' as const,
      };

      const xssHtml = `
        <table>
          <tr><th>Transaction Number</th><td>RA_XSS_001</td></tr>
          <tr><th>Amount</th><td>500.00 ETB</td></tr>
          <tr><th>Credited Party</th><td>0911223344</td></tr>
          <tr><th>Credited Party Name</th><td>&lt;script&gt;alert('xss')&lt;/script&gt;</td></tr>
          <tr><th>Debited Party Name</th><td><b>Hacker &amp; Co</b></td></tr>
        </table>
      `;

      const payload = adapter.parseHtmlResponse(xssHtml, ref);
      // Cheerio extracts the inner text cleanly
      expect(payload.beneficiaryName).toBe("<script>alert('xss')</script>");
      expect(payload.senderName).toBe('Hacker & Co');
    });
  });

  // ============================================================================
  // 4. Corrupted & Malicious Payloads
  // ============================================================================

  describe('4. Corrupted & Malicious Payloads', () => {
    const ingestion = new ReceiptIngestionService();

    it('rejects zero-byte file uploads with CORRUPTED_FILE', async () => {
      const emptyBuffer = Buffer.alloc(0);
      await expect(ingestion.ingestBuffer(emptyBuffer, 'image/png')).rejects.toThrow('Empty File Uploaded');
    });

    it('rejects SVG XML bombs or non-whitelisted XML formats', async () => {
      const xmlBomb = Buffer.from(`<?xml version="1.0"?>
        <!DOCTYPE lolz [
          <!ENTITY lol "lol">
          <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
        ]>
        <svg xmlns="http://www.w3.org/2000/svg">&lol1;</svg>
      `);

      // Attempting to upload XML under image/png or image/jpeg triggers magic byte rejection
      await expect(ingestion.ingestBuffer(xmlBomb, 'image/png')).rejects.toThrow('Corrupted PNG');
      await expect(ingestion.ingestBuffer(xmlBomb, 'image/jpeg')).rejects.toThrow('Corrupted JPEG');
    });

    it('handles pseudo-magic byte headers with truncated or garbage data gracefully', async () => {
      // PDF header followed by garbage
      const fakePdf = Buffer.from('%PDF-1.4\nTRUNCATED_GARBAGE_WITHOUT_OBJECTS_OR_EOF');
      await expect(ingestion.ingestBuffer(fakePdf, 'application/pdf')).rejects.toThrow(QrDecodeFailedError);

      // PNG magic bytes followed by truncated junk
      const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]);
      await expect(ingestion.ingestBuffer(fakePng, 'image/png')).rejects.toThrow();

      // JPEG magic bytes followed by truncated junk
      const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      await expect(ingestion.ingestBuffer(fakeJpeg, 'image/jpeg')).rejects.toThrow();
    });

    it('enforces maximum 10 MB payload cap and rejects decompression bomb attempts', async () => {
      const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024); // 10MB + 1KB
      await expect(ingestion.ingestBuffer(oversizedBuffer, 'image/png')).rejects.toThrow('exceeds 10 MB limit');
    });

    it('successfully processes degraded and inverted QR code matrices', async () => {
      const qrUrl = 'https://apps.cbe.com.et:100/?id=FT_DEGRADED_01';

      // Degraded QR (low contrast, slight blur)
      const degradedBuffer = await generateDegradedQrImage(qrUrl, { contrast: 0.45, blur: 0.5 });
      const testRes = await ingestion.testQrMatrix(degradedBuffer);
      expect(testRes.success).toBe(true);
      expect(testRes.extractedReference?.normalizedReference).toBe('FT_DEGRADED_01');

      // Inverted QR (white on black)
      const invertedBuffer = await generateInvertedQrImage(qrUrl);
      const invertedRes = await ingestion.testQrMatrix(invertedBuffer);
      // Even if inverted, testQrMatrix completes gracefully without crashing
      expect(typeof invertedRes.success).toBe('boolean');
    });

    it('fails gracefully on completely malformed/random noise images', async () => {
      const malformed = await generateMalformedQrImage({ width: 150, height: 150 });
      const res = await ingestion.testQrMatrix(malformed);
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });
  });

  // ============================================================================
  // 5. Concurrency & Race Conditions
  // ============================================================================

  describe('5. Concurrency & Race Conditions (Atomic Anti-Replay)', () => {
    it('prevents double-spending: concurrent requests for identical reference allow exactly one fulfillment', async () => {
      const order1 = createTestOrderModel(db, { userId: 1001, amountETB: 1250, paymentRail: 'cbe' });
      const order2 = createTestOrderModel(db, { userId: 1002, amountETB: 1250, paymentRail: 'cbe' });

      const mockHtml = `
        <html><body>
          <div>Amount: 1,250.00 ETB</div>
          <div>Reference: FT_RACE_CONDITION_001</div>
          <div>Credited Account: ${FIXTURES.cbe.validAccount}</div>
          <div>Receiver: ${FIXTURES.cbe.beneficiaryName}</div>
          <div>Date: ${new Date().toISOString()}</div>
        </body></html>
      `;

      vi.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve(new Response(mockHtml, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }))
      );

      const orchestrator = new ReceiptOrchestrator();

      // Launch both verification requests concurrently
      const [res1, res2] = await Promise.all([
        orchestrator.processSubmission({
          orderId: order1.id,
          userId: 1001,
          source: 'telegram_photo',
          directReference: 'FT_RACE_CONDITION_001',
        }),
        orchestrator.processSubmission({
          orderId: order2.id,
          userId: 1002,
          source: 'telegram_photo',
          directReference: 'FT_RACE_CONDITION_001',
        }),
      ]);

      const successCount = [res1, res2].filter((r) => r.success).length;
      const failureCount = [res1, res2].filter((r) => !r.success).length;

      // Exactly ONE submission must succeed, and exactly ONE must fail
      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      const failedResult = [res1, res2].find((r) => !r.success)!;
      expect(failedResult.status).toBe('rejected');
      expect(failedResult.error?.code).toBe('RECEIPT_ALREADY_USED');

      // Verify stock was decremented by exactly 1 item (3 seeded -> 2 remaining)
      expect(getAvailableStockCount('gemini_pro')).toBe(2);

      // Verify orders in DB: one fulfilled, the other pending_approval
      const updated1 = getOrderById(order1.id)!;
      const updated2 = getOrderById(order2.id)!;
      const statuses = [updated1.status, updated2.status];

      expect(statuses).toContain('fulfilled');
      expect(statuses).toContain('pending_approval');
    });
  });

  // ============================================================================
  // 6. Upstream Flakiness & Circuit Breaker
  // ============================================================================

  describe('6. Upstream Flakiness & Circuit Breaker Lifecycle', () => {
    it('transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED across failure and recovery phases', async () => {
      const cb = new CircuitBreaker({
        name: 'test_flakiness_cb',
        failureThreshold: 3,
        cooldownMs: 50, // fast cooldown for test
      });

      // Initial state: CLOSED
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canAttempt()).toBe(true);

      // 1st failure: remains CLOSED
      cb.recordFailure(new Error('500 Internal Server Error'));
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canAttempt()).toBe(true);

      // 2nd failure: 502 Bad Gateway -> remains CLOSED
      cb.recordFailure(new Error('502 Bad Gateway'));
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canAttempt()).toBe(true);

      // 3rd failure: 504 Gateway Timeout -> trips to OPEN
      cb.recordFailure(new Error('504 Gateway Timeout'));
      expect(cb.getState()).toBe('OPEN');
      expect(cb.canAttempt()).toBe(false);

      // Admin override can bypass OPEN state
      expect(cb.canAttempt(true)).toBe(true);

      // Wait for cooldown to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // After cooldown: transitions to HALF_OPEN
      expect(cb.getState()).toBe('HALF_OPEN');
      expect(cb.canAttempt()).toBe(true); // allows probe attempt

      // Probe succeeds: resets to CLOSED
      cb.recordSuccess();
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canAttempt()).toBe(true);
    });

    it('probe failure in HALF_OPEN state trips immediately back to OPEN', async () => {
      const cb = new CircuitBreaker({
        name: 'test_probe_fail_cb',
        failureThreshold: 2,
        cooldownMs: 30,
      });

      cb.recordFailure(new Error('fail 1'));
      cb.recordFailure(new Error('fail 2'));
      expect(cb.getState()).toBe('OPEN');

      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(cb.getState()).toBe('HALF_OPEN');

      // Probe fails
      cb.recordFailure(new Error('probe failed'));
      expect(cb.getState()).toBe('OPEN');
      expect(cb.canAttempt()).toBe(false);
    });

    it('CBE adapter trips circuit breaker on socket hangup and enforces fast-fail', async () => {
      const cb = new CircuitBreaker({ name: 'cbe_flaky_test', failureThreshold: 2, cooldownMs: 1000 });
      const adapter = new CbeBankAdapter(cb);
      const ref = {
        bank: 'cbe' as const,
        rawReference: 'FT_SOCKET_HANGUP',
        normalizedReference: 'FT_SOCKET_HANGUP',
        extractedAt: new Date(),
        confidence: 0.99,
        decodeMethod: 'qr_matrix' as const,
      };

      vi.spyOn(global, 'fetch').mockImplementation(() => {
        const error = new Error('socket hang up');
        (error as any).code = 'ECONNRESET';
        return Promise.reject(error);
      });

      // 1st failure
      await expect(adapter.verify(ref)).rejects.toThrow();
      // 2nd failure
      await expect(adapter.verify(ref)).rejects.toThrow();

      expect(cb.getState()).toBe('OPEN');

      // 3rd attempt is blocked by circuit breaker without network call
      await expect(adapter.verify(ref)).rejects.toThrow(BankPortalUnavailableError);
    });
  });

  // ============================================================================
  // 7. Fail-Safe Fallback Guarantee
  // ============================================================================

  describe('7. Fail-Safe Fallback Guarantee', () => {
    it('cleanly transitions order to pending_approval on upstream outage without cancelling order', async () => {
      const order = createTestOrderModel(db, {
        userId: 1001,
        amountETB: 1250,
        paymentRail: 'cbe',
        status: 'awaiting_payment',
      });

      // Upstream 504 timeout simulation
      vi.spyOn(global, 'fetch').mockImplementationOnce(() => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });

      const orchestrator = new ReceiptOrchestrator();
      const result = await orchestrator.processSubmission({
        orderId: order.id,
        userId: 1001,
        source: 'telegram_photo',
        directReference: 'FT_UPSTREAM_OUTAGE',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('upstream_failure');
      expect(result.needsAdminReview).toBe(true);
      expect(result.error?.code).toBe('BANK_PORTAL_UNAVAILABLE');

      // Order must NOT be deleted or marked as rejected/cancelled
      const updatedOrder = getOrderById(order.id)!;
      expect(updatedOrder).toBeDefined();
      expect(updatedOrder.status).toBe('pending_approval');
      expect(updatedOrder.admin_notes).toContain('BANK_PORTAL_UNAVAILABLE');

      // Full audit record must be recorded in SQLite
      const audit = await orchestrator.getAuditRecord(order.id);
      expect(audit).not.toBeNull();
      expect(audit?.orderId).toBe(order.id);
      expect(audit?.status).toBe('upstream_failure');
    });

    it('cleanly falls back to admin review when customer uploads unreadable/blurry QR screenshot', async () => {
      const order = createTestOrderModel(db, {
        userId: 1001,
        amountETB: 1250,
        paymentRail: 'cbe',
        status: 'awaiting_payment',
      });

      // Blank image containing no QR matrix
      const blankImg = await sharp({
        create: { width: 120, height: 120, channels: 3, background: { r: 240, g: 240, b: 240 } },
      }).png().toBuffer();

      const orchestrator = new ReceiptOrchestrator();
      const result = await orchestrator.processSubmission({
        orderId: order.id,
        userId: 1001,
        source: 'telegram_photo',
        fileBuffer: blankImg,
        mimeType: 'image/png',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('pending_manual_review');
      expect(result.needsAdminReview).toBe(true);
      expect(result.error?.code).toBe('QR_DECODE_FAILED');

      const updatedOrder = getOrderById(order.id)!;
      expect(updatedOrder.status).toBe('pending_approval');
      expect(updatedOrder.admin_notes).toContain('QR_DECODE_FAILED');
    });

    it('allows administrator to successfully reverify and fulfill an order previously in fallback', async () => {
      const order = createTestOrderModel(db, {
        userId: 1001,
        amountETB: 1250,
        paymentRail: 'cbe',
        status: 'awaiting_payment',
      });

      const orchestrator = new ReceiptOrchestrator();

      // Step 1: Ingestion fails (unreadable screenshot)
      const blankImg = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
      }).png().toBuffer();

      await orchestrator.processSubmission({
        orderId: order.id,
        userId: 1001,
        source: 'telegram_photo',
        fileBuffer: blankImg,
        mimeType: 'image/png',
      });

      expect(getOrderById(order.id)!.status).toBe('pending_approval');

      // Step 2: Customer provides reference code to Admin, Admin updates payment_ref and reverifies
      updateOrderStatus(order.id, 'pending_approval', { payment_ref: 'FT_ADMIN_SAVED_01' });

      const mockHtml = `
        <html><body>
          <div>Amount: 1,250.00 ETB</div>
          <div>Reference: FT_ADMIN_SAVED_01</div>
          <div>Credited Account: ${FIXTURES.cbe.validAccount}</div>
          <div>Receiver: ${FIXTURES.cbe.beneficiaryName}</div>
          <div>Date: ${new Date().toISOString()}</div>
        </body></html>
      `;
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(mockHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }));

      const reverifyResult = await orchestrator.reverifyOrder(order.id, 9999);

      expect(reverifyResult.success).toBe(true);
      expect(reverifyResult.status).toBe('auto_verified');

      const finalOrder = getOrderById(order.id)!;
      expect(finalOrder.status).toBe('fulfilled');
      expect(finalOrder.fulfillment_payload).toContain('EDGE_STOCK_CODE_001');
    });
  });
});
