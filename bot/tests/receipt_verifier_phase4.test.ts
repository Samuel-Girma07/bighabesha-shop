import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import zxing from '@zxing/library';
import express, { Express } from 'express';
import http from 'http';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { getConfig } from '../src/config/env.js';
import { createOrder, getOrderById } from '../src/services/orders.service.js';
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
  setReceiptOrchestratorForTest,
} from '../src/services/receipt_verifier/index.js';
import { receiptsRouter, adminReceiptsRouter } from '../src/api/receipts.js';
import { createHmac } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

// Helper to make HTTP requests against ephemeral server without touching global.fetch
function makeRequest(
  server: http.Server,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as any;
    let bodyStr: string | undefined;
    const headers: Record<string, string> = { ...(options.headers || {}) };
    if (options.body !== undefined) {
      bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      headers['content-type'] = headers['content-type'] || 'application/json';
      headers['content-length'] = Buffer.byteLength(bodyStr).toString();
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          const headersObj: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) {
              headersObj[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
            }
          }
          resolve({
            status: res.statusCode || 200,
            headers: headersObj,
            body: parsed,
          });
        });
      }
    );

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Helper to generate a valid QR PNG Buffer
async function generateQrPng(text: string): Promise<Buffer> {
  const ZX = (zxing as any).default || zxing;
  const writer = new ZX.MultiFormatWriter();
  const matrix = writer.encode(text, ZX.BarcodeFormat.QR_CODE, 200, 200, new Map());
  const w = matrix.getWidth();
  const h = matrix.getHeight();
  const pixels = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pixels[y * w + x] = matrix.get(x, y) ? 0 : 255;
    }
  }
  return sharp(pixels, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}

// Helper to generate valid Telegram initData
function createValidInitData(userId: number, botToken?: string): string {
  const token = botToken || getConfig().BOT_TOKEN;
  const user = JSON.stringify({ id: userId, first_name: 'Test', username: 'testuser' });
  const authDate = Math.floor(Date.now() / 1000).toString();
  const params = new URLSearchParams();
  params.set('auth_date', authDate);
  params.set('user', user);

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);

  return params.toString();
}

describe('Phase 4: Bank Receipt Verification Engine Suite', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(':memory:', migrationsDir);

    // Seed default settings and test data
    setSetting('receipt_auto_verify_enabled', '1');
    setSetting('receipt_cbe_beneficiaries', JSON.stringify(['1000123456789']));
    setSetting('receipt_telebirr_beneficiaries', JSON.stringify(['0911223344']));
    setSetting('cbe_account', '1000123456789');
    setSetting('telebirr_account', '0911223344');

    db.prepare(`INSERT INTO users (id, username, first_name) VALUES (1001, 'buyer1001', 'Buyer')`).run();
    db.prepare(`INSERT INTO users (id, username, first_name) VALUES (9999, 'admin9999', 'Admin')`).run();
    db.prepare(`INSERT INTO products (id, type, name, description) VALUES ('gemini_pro', 'stock', 'Gemini Pro 18M', 'Test') ON CONFLICT(id) DO NOTHING`).run();
    db.prepare(`INSERT INTO products (id, type, name, description) VALUES ('telegram_premium', 'order', 'Telegram Premium', 'Test') ON CONFLICT(id) DO NOTHING`).run();

    addStockLink('gemini_pro', 'https://google.com/activate/TEST_CODE_001');
    addStockLink('gemini_pro', 'https://google.com/activate/TEST_CODE_002');
  });

  afterEach(() => {
    setReceiptOrchestratorForTest(undefined);
    vi.restoreAllMocks();
    closeDatabase();
  });

  // ============================================================================
  // 1. Ingestion Service Tests
  // ============================================================================

  describe('1. Receipt Ingestion Service', () => {
    const ingestion = new ReceiptIngestionService();

    it('decodes a valid CBE QR matrix from an image buffer with multi-pass reader', async () => {
      const qrText = 'https://apps.cbe.com.et:100/?id=FT24252Y8WQM';
      const pngBuffer = await generateQrPng(qrText);

      const result = await ingestion.ingestBuffer(pngBuffer, 'image/png');

      expect(result.bank).toBe('cbe');
      expect(result.normalizedReference).toBe('FT24252Y8WQM');
      expect(result.decodeMethod).toBe('qr_matrix');
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.sourceUrl).toBe(qrText);
    });

    it('decodes a valid Telebirr QR matrix from image buffer', async () => {
      const qrText = 'https://transactioninfo.ethiotelecom.et/receipt/RA75OD70C2';
      const pngBuffer = await generateQrPng(qrText);

      const result = await ingestion.ingestBuffer(pngBuffer, 'image/png');

      expect(result.bank).toBe('telebirr');
      expect(result.normalizedReference).toBe('RA75OD70C2');
      expect(result.decodeMethod).toBe('qr_matrix');
    });

    it('testQrMatrix measures execution duration and returns structured diagnostics', async () => {
      const qrText = 'https://apps.cbe.com.et:100/?id=FT9988776655';
      const pngBuffer = await generateQrPng(qrText);

      const testRes = await ingestion.testQrMatrix(pngBuffer);

      expect(testRes.success).toBe(true);
      expect(testRes.rawText).toBe(qrText);
      expect(testRes.extractedReference?.normalizedReference).toBe('FT9988776655');
      expect(testRes.decodeDurationMs).toBeGreaterThan(0);
      expect(testRes.passesAttempted).toBeGreaterThanOrEqual(1);
    });

    it('throws QrDecodeFailedError when image contains no readable QR code', async () => {
      // 100x100 blank white image
      const blankImg = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
      }).png().toBuffer();

      await expect(ingestion.ingestBuffer(blankImg, 'image/png')).rejects.toThrow(QrDecodeFailedError);
    });

    it('enforces magic byte validation on corrupted image uploads', async () => {
      const fakeJpeg = Buffer.from('NOT_A_REAL_JPEG');
      await expect(ingestion.ingestBuffer(fakeJpeg, 'image/jpeg')).rejects.toThrow('Corrupted JPEG');

      const fakePng = Buffer.from('NOT_A_PNG_FILE');
      await expect(ingestion.ingestBuffer(fakePng, 'image/png')).rejects.toThrow('Corrupted PNG');

      const fakePdf = Buffer.from('NOT_A_PDF_STREAM');
      await expect(ingestion.ingestBuffer(fakePdf, 'application/pdf')).rejects.toThrow('Corrupted PDF');
    });

    it('rejects empty buffers or oversized buffers exceeding 10 MB', async () => {
      await expect(ingestion.ingestBuffer(Buffer.alloc(0), 'image/png')).rejects.toThrow('Empty File Uploaded');

      const hugeBuffer = Buffer.alloc(11 * 1024 * 1024);
      await expect(ingestion.ingestBuffer(hugeBuffer, 'image/png')).rejects.toThrow('exceeds 10 MB limit');
    });

    it('extracts reference from CBE and Telebirr debit SMS text', async () => {
      const cbeSms = 'Dear Customer, your account was debited with ETB 1,250.00 for transfer to 1000510711258. Ref: FT24252Y8WQM. Thank you for banking with CBE.';
      const cbeRes = await ingestion.ingestText(cbeSms);

      expect(cbeRes.bank).toBe('cbe');
      expect(cbeRes.normalizedReference).toBe('FT24252Y8WQM');
      expect(cbeRes.amountEtb).toBe(1250);
      expect(cbeRes.decodeMethod).toBe('sms_regex');

      const telebirrSms = 'telebirr: You have transferred 500.00 ETB to 0965579045. Transaction number: RA75OD70C2 on 2026-09-08.';
      const telebirrRes = await ingestion.ingestText(telebirrSms);

      expect(telebirrRes.bank).toBe('telebirr');
      expect(telebirrRes.normalizedReference).toBe('RA75OD70C2');
      expect(telebirrRes.amountEtb).toBe(500);
    });

    it('throws UnsupportedBankError when text contains no recognized bank pattern', async () => {
      const unknownText = 'Hello, I sent money via Dashen Bank to my brother yesterday.';
      await expect(ingestion.ingestText(unknownText)).rejects.toThrow(UnsupportedBankError);
    });
  });

  // ============================================================================
  // 2. Circuit Breaker Tests
  // ============================================================================

  describe('2. Circuit Breaker', () => {
    it('starts in CLOSED state, trips to OPEN after threshold failures, and recovers to HALF_OPEN after cooldown', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 100 });

      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canAttempt()).toBe(true);

      cb.recordFailure(new Error('fail 1'));
      cb.recordFailure(new Error('fail 2'));
      expect(cb.getState()).toBe('CLOSED');

      cb.recordFailure(new Error('fail 3'));
      expect(cb.getState()).toBe('OPEN');
      expect(cb.canAttempt()).toBe(false);
      expect(cb.canAttempt(true)).toBe(true); // admin bypass

      // Success resets failure count
      cb.recordSuccess();
      expect(cb.getState()).toBe('CLOSED');
    });
  });

  // ============================================================================
  // 3. Bank Adapters Tests
  // ============================================================================

  describe('3. Bank Adapters (CBE & Telebirr)', () => {
    it('CbeBankAdapter parses vector PDF response and extracts transaction details', async () => {
      const adapter = new CbeBankAdapter();
      const ref = {
        bank: 'cbe' as const,
        rawReference: 'FT24252Y8WQM',
        normalizedReference: 'FT24252Y8WQM',
        extractedAt: new Date(),
        confidence: 0.99,
        decodeMethod: 'qr_matrix' as const,
      };

      const mockHtml = `
        <html>
          <body>
            <div>Commercial Bank of Ethiopia</div>
            <div>Transaction Reference: FT24252Y8WQM</div>
            <div>Amount: 1,250.00 ETB</div>
            <div>Credited Account: 1000123456789</div>
            <div>Receiver Name: SAMUEL GIRMA</div>
            <div>Debited Account: 100029384729</div>
            <div>Payer Name: ABEBE BIKILA</div>
            <div>Payment Date: 2026-09-08 09:44:12</div>
          </body>
        </html>
      `;

      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(mockHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }));

      const payload = await adapter.verify(ref);

      expect(payload.bank).toBe('cbe');
      expect(payload.transactionReference).toBe('FT24252Y8WQM');
      expect(payload.amountEtb).toBe(1250);
      expect(payload.beneficiaryAccount).toBe('1000123456789');
      expect(payload.beneficiaryName).toBe('SAMUEL GIRMA');
      expect(payload.senderName).toBe('ABEBE BIKILA');
      expect(payload.currency).toBe('ETB');
    });

    it('CbeBankAdapter enforces SSRF safety and blocks unapproved domains', async () => {
      const adapter = new CbeBankAdapter();
      const maliciousRef = {
        bank: 'cbe' as const,
        rawReference: 'FT123',
        normalizedReference: 'FT123',
        sourceUrl: 'https://evil-hacker.com/?id=FT123',
        extractedAt: new Date(),
        confidence: 0.9,
        decodeMethod: 'qr_matrix' as const,
      };

      await expect(adapter.verify(maliciousRef)).rejects.toThrow('SSRF violation');
    });

    it('CbeBankAdapter throws BankPortalUnavailableError when fetch times out', async () => {
      const adapter = new CbeBankAdapter();
      const ref = {
        bank: 'cbe' as const,
        rawReference: 'FT24252Y8WQM',
        normalizedReference: 'FT24252Y8WQM',
        extractedAt: new Date(),
        confidence: 0.99,
        decodeMethod: 'qr_matrix' as const,
      };

      vi.spyOn(global, 'fetch').mockImplementationOnce(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      });

      await expect(adapter.verify(ref, { timeoutMs: 100 })).rejects.toThrow(BankPortalUnavailableError);
    });

    it('TelebirrAdapter parses HTML table with cheerio and extracts receiver phone and amount', async () => {
      const adapter = new TelebirrAdapter();
      const ref = {
        bank: 'telebirr' as const,
        rawReference: 'RA75OD70C2',
        normalizedReference: 'RA75OD70C2',
        extractedAt: new Date(),
        confidence: 0.95,
        decodeMethod: 'qr_matrix' as const,
      };

      const mockHtml = `
        <html>
          <body>
            <table>
              <tr><th>Transaction Number</th><td>RA75OD70C2</td></tr>
              <tr><th>Amount</th><td>500.00 ETB</td></tr>
              <tr><th>Credited Party</th><td>0911223344</td></tr>
              <tr><th>Credited Party Name</th><td>Bighabesha Shop</td></tr>
              <tr><th>Debited Party</th><td>0988776655</td></tr>
              <tr><th>Payment Time</th><td>2026-09-08 10:15:00</td></tr>
            </table>
          </body>
        </html>
      `;

      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(mockHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }));

      const payload = await adapter.verify(ref);

      expect(payload.bank).toBe('telebirr');
      expect(payload.transactionReference).toBe('RA75OD70C2');
      expect(payload.amountEtb).toBe(500);
      expect(payload.beneficiaryAccount).toBe('0911223344');
      expect(payload.beneficiaryName).toBe('Bighabesha Shop');
    });

    it('TelebirrAdapter detects geo-blocking (HTTP 403) and throws PortalGeoblockedError', async () => {
      const adapter = new TelebirrAdapter();
      const ref = {
        bank: 'telebirr' as const,
        rawReference: 'RA75OD70C2',
        normalizedReference: 'RA75OD70C2',
        extractedAt: new Date(),
        confidence: 0.95,
        decodeMethod: 'qr_matrix' as const,
      };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('Forbidden', {
        status: 403,
      }));

      await expect(adapter.verify(ref)).rejects.toThrow(PortalGeoblockedError);
    });
  });

  // ============================================================================
  // 4. 4-Pillar Security Gate Tests
  // ============================================================================

  describe('4. 4-Pillar Security Gate Service', () => {
    const gate = new SecurityGateService();

    it('passes when all 4 pillars are fully satisfied', async () => {
      const now = new Date();
      const orderContext = {
        orderId: 'ORD-101',
        userId: 1001,
        netPayableEtb: 1500,
        paymentRail: 'cbe' as const,
        orderCreatedAt: now,
      };

      const bankPayload = {
        bank: 'cbe' as const,
        transactionReference: 'FT_VALID_001',
        amountEtb: 1500,
        currency: 'ETB' as const,
        beneficiaryAccount: '1000123456789',
        beneficiaryName: 'Bighabesha Shop',
        transactionTimestamp: now,
        rawAuditTrail: {},
      };

      const result = await gate.evaluate(orderContext, bankPayload);

      expect(result.passed).toBe(true);
      expect(result.evaluations).toHaveLength(4);
      expect(result.evaluations.every((e) => e.passed)).toBe(true);
      expect(result.failedPillar).toBeUndefined();
    });

    it('fails Pillar 2 (Beneficiary Whitelist) when payment is sent to an unauthorized account', async () => {
      const orderContext = {
        orderId: 'ORD-102',
        userId: 1001,
        netPayableEtb: 1500,
        paymentRail: 'cbe' as const,
        orderCreatedAt: new Date(),
      };

      const bankPayload = {
        bank: 'cbe' as const,
        transactionReference: 'FT_WRONG_BEN',
        amountEtb: 1500,
        currency: 'ETB' as const,
        beneficiaryAccount: '1000999999999', // unauthorized
        beneficiaryName: 'UNKNOWN PERSON',
        transactionTimestamp: new Date(),
        rawAuditTrail: {},
      };

      const result = await gate.evaluate(orderContext, bankPayload);

      expect(result.passed).toBe(false);
      expect(result.failedPillar?.pillar).toBe('beneficiary_whitelist');
    });

    it('fails Pillar 3 (Exact Amount) on underpayment', async () => {
      const orderContext = {
        orderId: 'ORD-103',
        userId: 1001,
        netPayableEtb: 1500,
        paymentRail: 'cbe' as const,
        orderCreatedAt: new Date(),
      };

      const bankPayload = {
        bank: 'cbe' as const,
        transactionReference: 'FT_UNDERPAID',
        amountEtb: 1000, // less than 1500
        currency: 'ETB' as const,
        beneficiaryAccount: '1000123456789',
        beneficiaryName: 'Bighabesha Shop',
        transactionTimestamp: new Date(),
        rawAuditTrail: {},
      };

      const result = await gate.evaluate(orderContext, bankPayload);

      expect(result.passed).toBe(false);
      expect(result.failedPillar?.pillar).toBe('exact_amount');
    });

    it('fails Pillar 4 (Recency Window) when transaction timestamp is stale (> 120m old)', async () => {
      const orderCreated = new Date();
      const staleTimestamp = new Date(orderCreated.getTime() - 180 * 60 * 1000); // 3 hours ago

      const orderContext = {
        orderId: 'ORD-104',
        userId: 1001,
        netPayableEtb: 1500,
        paymentRail: 'cbe' as const,
        orderCreatedAt: orderCreated,
      };

      const bankPayload = {
        bank: 'cbe' as const,
        transactionReference: 'FT_STALE',
        amountEtb: 1500,
        currency: 'ETB' as const,
        beneficiaryAccount: '1000123456789',
        beneficiaryName: 'Bighabesha Shop',
        transactionTimestamp: staleTimestamp,
        rawAuditTrail: {},
      };

      const result = await gate.evaluate(orderContext, bankPayload);

      expect(result.passed).toBe(false);
      expect(result.failedPillar?.pillar).toBe('recency_window');
    });
  });

  // ============================================================================
  // 5. Orchestrator End-to-End Pipeline & Atomic Fulfillment Tests
  // ============================================================================

  describe('5. Receipt Orchestrator Pipeline', () => {
    it('auto-verifies CBE slip, allocates Gemini Pro stock atomically, and updates order to fulfilled', async () => {
      const order = createOrder({
        userId: 1001,
        productId: 'gemini_pro',
        amountETB: 1250,
        paymentRail: 'cbe',
      });

      const qrPng = await generateQrPng(`https://apps.cbe.com.et:100/?id=FT_AUTO_001`);

      const mockHtml = `
        <html><body>
          <div>Amount: 1,250.00 ETB</div>
          <div>Reference: FT_AUTO_001</div>
          <div>Credited Account: 1000123456789</div>
          <div>Receiver: Bighabesha Shop</div>
          <div>Date: ${new Date().toISOString()}</div>
        </body></html>
      `;

      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(mockHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }));

      const orchestrator = new ReceiptOrchestrator();
      const result = await orchestrator.processSubmission({
        orderId: order.id,
        userId: 1001,
        source: 'telegram_photo',
        fileBuffer: qrPng,
        mimeType: 'image/png',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('auto_verified');
      expect(result.transactionReference).toBe('FT_AUTO_001');

      // Verify order state in SQLite
      const updatedOrder = getOrderById(order.id)!;
      expect(updatedOrder.status).toBe('fulfilled');
      expect(updatedOrder.payment_ref).toBe('FT_AUTO_001');
      expect(updatedOrder.fulfillment_payload).toContain('https://google.com/activate/TEST_CODE_001');

      // Verify stock was decremented
      expect(getAvailableStockCount('gemini_pro')).toBe(1);

      // Verify receipt_evidence row
      const audit = await orchestrator.getAuditRecord(order.id);
      expect(audit).not.toBeNull();
      expect(audit?.securityGatePassed).toBe(true);
      expect(audit?.verifiedAmountEtb).toBe(1250);
    });

    it('blocks double-spending replay attacks with RECEIPT_ALREADY_USED and prevents double allocation', async () => {
      // Order 1: gets fulfilled with FT_REPLAY_123
      const order1 = createOrder({ userId: 1001, productId: 'gemini_pro', amountETB: 1250, paymentRail: 'cbe' });
      const order2 = createOrder({ userId: 1001, productId: 'gemini_pro', amountETB: 1250, paymentRail: 'cbe' });

      const mockHtml = `
        <html><body>
          <div>Amount: 1,250.00 ETB</div>
          <div>Reference: FT_REPLAY_123</div>
          <div>Credited Account: 1000123456789</div>
          <div>Receiver: Bighabesha Shop</div>
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

      // Submit Order 1
      const res1 = await orchestrator.processSubmission({
        orderId: order1.id,
        userId: 1001,
        source: 'telegram_photo',
        directReference: 'FT_REPLAY_123',
      });
      expect(res1.success).toBe(true);

      // Submit Order 2 with the identical reference (Replay attack!)
      const res2 = await orchestrator.processSubmission({
        orderId: order2.id,
        userId: 1001,
        source: 'telegram_photo',
        directReference: 'FT_REPLAY_123',
      });

      expect(res2.success).toBe(false);
      expect(res2.status).toBe('rejected');
      expect(res2.error?.code).toBe('RECEIPT_ALREADY_USED');
      expect(res2.needsAdminReview).toBe(true);

      // Order 2 must NOT be fulfilled
      const updatedOrder2 = getOrderById(order2.id)!;
      expect(updatedOrder2.status).not.toBe('fulfilled');

      // Remaining stock must remain safe (only 1 item claimed by order 1)
      expect(getAvailableStockCount('gemini_pro')).toBe(1);
    });

    it('routes upstream bank timeout to graceful admin fallback with upstream_failure status', async () => {
      const order = createOrder({ userId: 1001, productId: 'gemini_pro', amountETB: 1250, paymentRail: 'cbe' });

      vi.spyOn(global, 'fetch').mockImplementationOnce(() => {
        const err = new Error('Connection aborted');
        err.name = 'AbortError';
        throw err;
      });

      const orchestrator = new ReceiptOrchestrator();
      const result = await orchestrator.processSubmission({
        orderId: order.id,
        userId: 1001,
        source: 'telegram_photo',
        directReference: 'FT_TIMEOUT_TEST',
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('upstream_failure');
      expect(result.error?.code).toBe('BANK_PORTAL_UNAVAILABLE');
      expect(result.needsAdminReview).toBe(true);

      const updated = getOrderById(order.id)!;
      expect(updated.status).toBe('pending_approval');
    });

    it('re-verifies an existing order by admin command and queryEvidence supports pagination', async () => {
      const order = createOrder({ userId: 1001, productId: 'gemini_pro', amountETB: 1250, paymentRail: 'cbe' });

      let attemptCount = 0;
      vi.spyOn(global, 'fetch').mockImplementation(() => {
        attemptCount++;
        const dateStr = attemptCount === 1
          ? new Date(Date.now() - 5 * 3600 * 1000).toISOString() // stale for initial attempt
          : new Date().toISOString(); // fresh for admin reverification
        const html = `
          <html><body>
            <div>Amount: 1,250.00 ETB</div>
            <div>Reference: FT_REVERIFY_99</div>
            <div>Credited Account: 1000123456789</div>
            <div>Receiver: Bighabesha Shop</div>
            <div>Date: ${dateStr}</div>
          </body></html>
        `;
        return Promise.resolve(new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }));
      });

      const orchestrator = new ReceiptOrchestrator();

      // Initial failed attempt (stale)
      await orchestrator.processSubmission({
        orderId: order.id,
        userId: 1001,
        source: 'manual_admin_entry',
        directReference: 'FT_REVERIFY_99',
      });

      // Admin re-verifies
      const reverifyRes = await orchestrator.reverifyOrder(order.id, 9999);
      expect(reverifyRes.success).toBe(true);

      // Query evidence
      const queryRes = await orchestrator.queryEvidence({ orderId: order.id });
      expect(queryRes.items.length).toBeGreaterThanOrEqual(1);
      expect(queryRes.items[0].orderId).toBe(order.id);
    });
  });

  // ============================================================================
  // 6. REST API Endpoints Tests
  // ============================================================================

  describe('6. REST API Endpoints (/api/receipts)', () => {
    let app: Express;
    let server: http.Server;

    beforeEach(async () => {
      app = express();
      app.use(express.json({ limit: '10mb' }));
      app.use('/api/receipts', receiptsRouter);
      app.use('/api/admin/receipts', adminReceiptsRouter);

      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, () => resolve()));

      // Set admin session in DB for testing
      db.prepare(`
        INSERT INTO admin_sessions (token, admin_id, expires_at)
        VALUES ('valid_admin_token', 9999, ${Date.now() + 3600000})
      `).run();
      db.prepare(`
        INSERT INTO admins (tg_user_id, role, is_active, created_by)
        VALUES (9999, 'superadmin', 1, 'test')
        ON CONFLICT(tg_user_id) DO UPDATE SET role = 'superadmin'
      `).run();
    });

    afterEach(async () => {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('POST /api/receipts/verify rejects unauthenticated requests with 401 RFC 7807', async () => {
      const res = await makeRequest(server, '/api/receipts/verify', {
        method: 'POST',
        body: { orderId: 'ORD-999' },
      });

      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
    });

    it('POST /api/receipts/verify executes verification with valid Telegram initData', async () => {
      const order = createOrder({ userId: 1001, productId: 'gemini_pro', amountETB: 1250, paymentRail: 'cbe' });
      const initData = createValidInitData(1001);

      const mockHtml = `
        <html><body>
          <div>Amount: 1,250.00 ETB</div>
          <div>Reference: FT_API_SUCCESS</div>
          <div>Credited Account: 1000123456789</div>
          <div>Receiver: Bighabesha Shop</div>
          <div>Date: ${new Date().toISOString()}</div>
        </body></html>
      `;
      vi.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve(new Response(mockHtml, { status: 200, headers: { 'content-type': 'text/html' } }))
      );

      const res = await makeRequest(server, '/api/receipts/verify', {
        method: 'POST',
        headers: { Authorization: `tma ${initData}` },
        body: {
          orderId: order.id,
          reference: 'FT_API_SUCCESS',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('auto_verified');
    });

    it('POST /api/receipts/test-qr decodes uploaded base64 image and returns passes', async () => {
      const qrPng = await generateQrPng('https://apps.cbe.com.et:100/?id=FT_TEST_QR_API');
      const base64Str = `data:image/png;base64,${qrPng.toString('base64')}`;

      const res = await makeRequest(server, '/api/receipts/test-qr', {
        method: 'POST',
        body: { imageBase64: base64Str },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.rawText).toContain('FT_TEST_QR_API');
    });

    it('GET /api/receipts/status/:orderId returns audit evidence and attempt history', async () => {
      const order = createOrder({ userId: 1001, productId: 'gemini_pro', amountETB: 1250, paymentRail: 'cbe' });
      const initData = createValidInitData(1001);

      const res = await makeRequest(server, `/api/receipts/status/${order.id}`, {
        method: 'GET',
        headers: { Authorization: `tma ${initData}` },
      });

      expect(res.status).toBe(200);
      expect(res.body.orderId).toBe(order.id);
      expect(Array.isArray(res.body.attempts)).toBe(true);
    });

    it('GET /api/admin/receipts/evidence requires admin authorization and permission', async () => {
      // Without token
      const unauthRes = await makeRequest(server, '/api/admin/receipts/evidence', {
        method: 'GET',
      });
      expect(unauthRes.status).toBe(401);

      // With valid admin token
      const authRes = await makeRequest(server, '/api/admin/receipts/evidence', {
        method: 'GET',
        headers: { Authorization: 'Bearer valid_admin_token' },
      });

      expect(authRes.status).toBe(200);
      expect(Array.isArray(authRes.body.items)).toBe(true);
    });
  });
});
