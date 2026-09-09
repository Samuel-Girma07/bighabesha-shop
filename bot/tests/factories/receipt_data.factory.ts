/**
 * Bighabesha Shop - Ethiopian Bank Receipt Verification Engine
 * Mock Data Factories & Realistic Synthetic Fixture Generators
 *
 * Phase 6: Quality Playbook & Compliance Test Framework
 */

import Database from 'better-sqlite3';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import zxing from '@zxing/library';
import { createOrder, Order, OrderStatus } from '../../src/services/orders.service.js';
import {
  SupportedBank,
  OrderSecurityContext,
  BankTransactionPayload,
  ReceiptSubmission,
} from '../../src/services/receipt_verifier/types.js';

// ============================================================================
// 1. Synthetic CBE Vector PDF Factory
// ============================================================================

export interface SyntheticCbePdfOptions {
  reference: string;
  amountEtb: number;
  creditedAccount: string;
  debitedAccount?: string;
  receiverName?: string;
  payerName?: string;
  dateStr?: string;
  includeAmharic?: boolean;
}

/**
 * Generates a realistic synthetic Commercial Bank of Ethiopia (CBE) vector PDF
 * containing the official receipt header, metadata fields, amounts, and dates.
 */
export async function generateSyntheticCbePdf(options: SyntheticCbePdfOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(18).text('Commercial Bank of Ethiopia', { align: 'center' });
    doc.fontSize(10).text('Electronic Payment Confirmation Slip', { align: 'center' });
    doc.moveDown(1.5);

    // Metadata Key-Value pairs
    doc.fontSize(12);
    doc.text(`Transaction Reference: ${options.reference}`);
    doc.text(`Amount: ${options.amountEtb.toFixed(2)} ETB`);
    doc.text(`Credited Account: ${options.creditedAccount}`);
    doc.text(`Receiver Name: ${options.receiverName || 'Bighabesha Shop'}`);

    if (options.debitedAccount) {
      doc.text(`Debited Account: ${options.debitedAccount}`);
    }
    if (options.payerName) {
      doc.text(`Payer Name: ${options.payerName}`);
    }

    doc.text(`Payment Date: ${options.dateStr || new Date().toISOString()}`);
    doc.moveDown();

    // Footer
    doc.fontSize(9).text('Thank you for banking with the Commercial Bank of Ethiopia.', { align: 'center' });
    doc.end();
  });
}

// ============================================================================
// 2. Synthetic Telebirr HTML Receipt Document Factory
// ============================================================================

export interface SyntheticTelebirrHtmlOptions {
  reference: string;
  amountEtb: number;
  creditedParty: string;
  creditedPartyName?: string;
  debitedParty?: string;
  debitedPartyName?: string;
  paymentTime?: string;
  statusBadge?: 'COMPLETED' | 'SUCCESS' | 'PENDING' | 'FAILED';
  tableLayoutVariant?: 'standard' | 'inverted_keys' | 'nested_divs' | 'extra_columns';
}

/**
 * Generates a synthetic Ethio Telecom Telebirr HTML transaction confirmation receipt
 * with dynamic table structures, badges, amounts, and phone numbers.
 */
export function generateSyntheticTelebirrHtml(options: SyntheticTelebirrHtmlOptions): string {
  const badge = options.statusBadge || 'COMPLETED';
  const time = options.paymentTime || new Date().toISOString();
  const creditedName = options.creditedPartyName || 'Bighabesha Shop';
  const debitedParty = options.debitedParty || '0988776655';
  const debitedName = options.debitedPartyName || 'Customer Abebe';

  if (options.tableLayoutVariant === 'extra_columns') {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Telebirr Transaction Receipt</title>
      </head>
      <body>
        <div class="receipt-card">
          <div class="badge ${badge.toLowerCase()}">${badge}</div>
          <h2>Ethio Telecom - Telebirr</h2>
          <table class="data-table">
            <thead>
              <tr><th>Field</th><th>Value</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr><td>Receipt Number</td><td>${options.reference}</td><td>Verified</td></tr>
              <tr><td>Transferred Amount</td><td>${options.amountEtb.toFixed(2)} ETB</td><td>Paid</td></tr>
              <tr><td>Credited Party</td><td>${options.creditedParty}</td><td>Active</td></tr>
              <tr><td>Credited Party Name</td><td>${creditedName}</td><td>Merchant</td></tr>
              <tr><td>Debited Party</td><td>${debitedParty}</td><td>Verified</td></tr>
              <tr><td>Payment Time</td><td>${time}</td><td>Success</td></tr>
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `;
  }

  // Standard Telebirr table layout
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>Telebirr Transaction Receipt - ${options.reference}</title>
    </head>
    <body>
      <div class="telebirr-container">
        <div class="receipt-header">
          <h1>telebirr</h1>
          <span class="status">${badge}</span>
        </div>
        <table border="1" cellpadding="8">
          <tr>
            <th>Transaction Number</th>
            <td>${options.reference}</td>
          </tr>
          <tr>
            <th>Amount</th>
            <td>${options.amountEtb.toFixed(2)} ETB</td>
          </tr>
          <tr>
            <th>Credited Party</th>
            <td>${options.creditedParty}</td>
          </tr>
          <tr>
            <th>Credited Party Name</th>
            <td>${creditedName}</td>
          </tr>
          <tr>
            <th>Debited Party</th>
            <td>${debitedParty}</td>
          </tr>
          <tr>
            <th>Debited Party Name</th>
            <td>${debitedName}</td>
          </tr>
          <tr>
            <th>Payment Time</th>
            <td>${time}</td>
          </tr>
        </table>
      </div>
    </body>
    </html>
  `;
}

// ============================================================================
// 3. Simulated QR Matrix Image Generators
// ============================================================================

interface QrImageOptions {
  width?: number;
  height?: number;
}

/**
 * Encodes a QR code string into a clean black-and-white PNG buffer.
 */
export async function generateValidQrImage(text: string, options: QrImageOptions = {}): Promise<Buffer> {
  const w = options.width || 250;
  const h = options.height || 250;

  const ZX = (zxing as unknown as { default?: typeof zxing }).default || zxing;
  const writer = new ZX.MultiFormatWriter();
  const matrix = writer.encode(text, ZX.BarcodeFormat.QR_CODE, w, h, new Map());

  const mw = matrix.getWidth();
  const mh = matrix.getHeight();
  const pixels = Buffer.alloc(mw * mh);

  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      pixels[y * mw + x] = matrix.get(x, y) ? 0 : 255;
    }
  }

  return sharp(pixels, { raw: { width: mw, height: mh, channels: 1 } })
    .png()
    .toBuffer();
}

/**
 * Generates a degraded QR image with lowered contrast and slight blur to stress-test
 * the multi-pass binarization and thresholding pipeline.
 */
export async function generateDegradedQrImage(
  text: string,
  options: { contrast?: number; blur?: number } = {}
): Promise<Buffer> {
  const basePng = await generateValidQrImage(text, { width: 300, height: 300 });
  const contrastFactor = options.contrast ?? 0.35; // low contrast
  const blurSigma = options.blur ?? 0.8;

  return sharp(basePng)
    .linear(contrastFactor, 90) // reduce dynamic range and shift midpoint
    .blur(blurSigma)
    .png()
    .toBuffer();
}

/**
 * Generates an inverted QR image (white code on black background).
 */
export async function generateInvertedQrImage(text: string): Promise<Buffer> {
  const basePng = await generateValidQrImage(text);
  return sharp(basePng).negate().png().toBuffer();
}

/**
 * Generates an intentionally malformed or non-decodable image buffer.
 */
export async function generateMalformedQrImage(
  options: { width?: number; height?: number; type?: 'garbage_pixels' | 'noise_pattern' } = {}
): Promise<Buffer> {
  const w = options.width || 200;
  const h = options.height || 200;

  // Generate pseudorandom static noise bytes
  const noisePixels = Buffer.alloc(w * h);
  for (let i = 0; i < noisePixels.length; i++) {
    noisePixels[i] = Math.random() > 0.5 ? 255 : 0;
  }

  return sharp(noisePixels, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
}

// ============================================================================
// 4. Standard Test Order Models across Diverse States
// ============================================================================

export interface TestOrderOptions {
  userId?: number;
  username?: string;
  productId?: string;
  variantId?: string | null;
  amountETB?: number;
  discountETB?: number;
  paymentRail?: 'cbe' | 'telebirr' | 'abyssinia';
  status?: OrderStatus;
  createdAt?: Date;
  targetUsername?: string | null;
}

/**
 * Creates a standard test order model in SQLite with configurable attributes,
 * states (new, awaiting_payment, pending_approval, fulfilled, rejected), and timestamps.
 */
export function createTestOrderModel(db: Database.Database, options: TestOrderOptions = {}): Order {
  const userId = options.userId || 1001;
  const username = options.username || 'testbuyer';
  const productId = options.productId || 'gemini_pro';
  const amountETB = options.amountETB ?? 1250;
  const paymentRail = options.paymentRail || 'cbe';
  const status = options.status || 'awaiting_payment';

  // Ensure user exists
  db.prepare(`
    INSERT INTO users (id, username, first_name)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(userId, username, 'Test User');

  // Ensure product exists
  db.prepare(`
    INSERT INTO products (id, type, name, description)
    VALUES (?, 'stock', 'Gemini Pro 18M', 'Test Product')
    ON CONFLICT(id) DO NOTHING
  `).run(productId);

  const order = createOrder({
    userId,
    username,
    productId,
    variantId: options.variantId || null,
    amountETB,
    paymentRail,
    status,
    targetUsername: options.targetUsername || null,
  });

  if (options.discountETB && options.discountETB > 0) {
    db.prepare(`UPDATE orders SET discount_etb = ? WHERE id = ?`).run(options.discountETB, order.id);
    order.discount_etb = options.discountETB;
  }

  if (options.createdAt) {
    const isoString = options.createdAt.toISOString();
    db.prepare(`UPDATE orders SET created_at = ? WHERE id = ?`).run(isoString, order.id);
    order.created_at = isoString;
  }

  return order;
}

/**
 * Creates a mock OrderSecurityContext for isolated security gate tests.
 */
export function createMockOrderSecurityContext(overrides: Partial<OrderSecurityContext> = {}): OrderSecurityContext {
  return {
    orderId: overrides.orderId || 'ORD-TEST-001',
    userId: overrides.userId || 1001,
    netPayableEtb: overrides.netPayableEtb ?? 1250,
    paymentRail: overrides.paymentRail || 'cbe',
    orderCreatedAt: overrides.orderCreatedAt || new Date(),
  };
}

/**
 * Creates a mock BankTransactionPayload for isolated security gate or adapter tests.
 */
export function createMockBankPayload(overrides: Partial<BankTransactionPayload> = {}): BankTransactionPayload {
  return {
    bank: overrides.bank || 'cbe',
    transactionReference: overrides.transactionReference || 'FT24252Y8WQM',
    amountEtb: overrides.amountEtb ?? 1250,
    currency: 'ETB',
    feeEtb: overrides.feeEtb || 0,
    senderName: overrides.senderName || 'ABEBE BIKILA',
    senderIdentifier: overrides.senderIdentifier || '100099887766',
    beneficiaryAccount: overrides.beneficiaryAccount || '1000123456789',
    beneficiaryName: overrides.beneficiaryName || 'Bighabesha Shop',
    transactionTimestamp: overrides.transactionTimestamp || new Date(),
    paymentChannel: overrides.paymentChannel || 'cbe_digital',
    rawAuditTrail: overrides.rawAuditTrail || {},
  };
}

/**
 * Creates a mock ReceiptSubmission object.
 */
export function createMockReceiptSubmission(overrides: Partial<ReceiptSubmission> = {}): ReceiptSubmission {
  return {
    orderId: overrides.orderId || 'ORD-TEST-001',
    userId: overrides.userId || 1001,
    source: overrides.source || 'telegram_photo',
    directReference: overrides.directReference,
    fileBuffer: overrides.fileBuffer,
    mimeType: overrides.mimeType,
    note: overrides.note,
    ipAddress: overrides.ipAddress || '127.0.0.1',
  };
}

// ============================================================================
// 5. Common Testing Fixtures & Constants
// ============================================================================

export const FIXTURES = Object.freeze({
  cbe: {
    validAccount: '1000123456789',
    foreignAccount: '1000999999999',
    validRef: 'FT24252Y8WQM',
    altRef: 'FT9988776655',
    beneficiaryName: 'Bighabesha Shop',
    unicodeAmharicName: 'ሳሙኤል ግርማ',
    unicodeAmharicPayer: 'አበበ ቢቂላ',
  },
  telebirr: {
    validPhone: '0911223344',
    foreignPhone: '0977665544',
    validRef: 'RA75OD70C2',
    altRef: 'TB9911882233',
    beneficiaryName: 'Bighabesha Shop',
    unicodeAmharicName: 'የሸዋወርቅ መንግስቱ',
    unicodeAmharicPayer: 'ዓለሙ ከበደ',
  },
  amounts: {
    standard: 1250,
    underpaid: 1249.99,
    overpaid: 1300,
    zero: 0,
  },
});
