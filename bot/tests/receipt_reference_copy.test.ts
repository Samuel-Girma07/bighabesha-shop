/**
 * Rail-aware customer copy for the bank transaction reference.
 *
 * The bot used to tell buyers to "type the transaction reference number (e.g.
 * FT26… for CBE)" in four places. `FT…` is the legacy CBE scheme, retired along
 * with the `apps.cbe.com.et` portal: CBE's confirmation SMS now carries a
 * mixed-case `v2-…` token, and `cbe.adapter.ts` rejects anything that is not one
 * *before any egress*. So the advertised example was not merely stale, it was a
 * guaranteed rejection — the worst possible thing to show a customer who is
 * already stuck in a retry loop.
 *
 * These tests pin the shape of the example to the rail the order is actually on,
 * in both languages, and assert the retired format appears nowhere.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { createOrder } from '../src/services/orders.service.js';
import { promptReceiptUpload, receiptReferenceExample } from '../src/bot/handlers/checkout.js';
import { handleTextInput } from '../src/bot/handlers/input.js';
import { setPendingAction, clearPendingAction } from '../src/bot/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

const BUYER_ID = 445500111;
const BUYER_ID_AM = 445500222;

/** Retired legacy CBE scheme. Must never reappear in buyer-facing copy. */
const RETIRED_FT_FORMAT = /FT\d/;

describe('receiptReferenceExample', () => {
  it('returns the CBE v2- token shape for the CBE rail', () => {
    const example = receiptReferenceExample('cbe');
    expect(example.label).toBe('CBE');
    // Exactly the form the CBE adapter accepts: `v2-` plus a 16-24 char body.
    expect(example.example).toMatch(/^v2-[A-Za-z0-9]{16,24}$/);
  });

  it('returns a Telebirr invoice-number shape for the Telebirr rail', () => {
    const example = receiptReferenceExample('telebirr');
    expect(example.label).toBe('Telebirr');
    // Telebirr labels a plain alphanumeric invoice number; no `v2-` prefix.
    expect(example.example).toMatch(/^[A-Za-z0-9]{8,20}$/);
    expect(example.example).not.toMatch(/^v2-/);
  });

  it('never advertises the retired FT scheme on any rail', () => {
    for (const rail of ['telebirr', 'cbe', 'abyssinia', 'wallet_pay', null, undefined]) {
      const { example } = receiptReferenceExample(rail);
      expect(example, `rail=${rail}`).not.toMatch(RETIRED_FT_FORMAT);
    }
  });
});

describe('Buyer-facing reference copy', () => {
  let sentTexts: string[] = [];

  /** Records every message the handler renders, in either delivery path. */
  function makeCtx(userId: number, lang = 'en') {
    const ctx: any = {
      from: { id: userId, language_code: lang, is_bot: false, first_name: 'Buyer' },
      callbackQuery: undefined,
      reply: async (text: string) => {
        sentTexts.push(text);
        return {};
      },
      editMessageText: async (text: string) => {
        sentTexts.push(text);
        return {};
      },
      editMessageCaption: async (opts: any) => {
        sentTexts.push(opts?.caption ?? '');
        return {};
      },
      api: {
        sendMessage: async () => ({}),
        sendPhoto: async () => ({}),
        sendDocument: async () => ({}),
      },
    };
    return ctx;
  }

  beforeEach(() => {
    process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = '12345';
    initDatabase(':memory:', migrationsDir);
    sentTexts = [];
  });

  afterEach(() => {
    clearPendingAction(BUYER_ID);
    clearPendingAction(BUYER_ID_AM);
    closeDatabase();
  });

  function seedOrder(userId: number, rail: 'telebirr' | 'cbe', lang: 'en' | 'am' = 'en') {
    // `createOrder` inserts the user row with the schema's default language, and
    // the handlers read the DB language first — `ctx.from.language_code` is only
    // the fallback. Seed it explicitly so the Amharic branch is really exercised.
    getDatabase()
      .prepare('INSERT INTO users (id, username, first_name, language_code) VALUES (?, ?, ?, ?)')
      .run(userId, 'copy_tester', 'Copy Tester', lang);

    return createOrder({
      userId,
      username: 'copy_tester',
      productId: 'telegram_premium',
      variantId: 'tg_prem_3m',
      amountETB: 1000,
      paymentRail: rail,
      status: 'awaiting_payment',
    });
  }

  describe('promptReceiptUpload', () => {
    it('shows the CBE v2- example to a CBE buyer, in English', async () => {
      const order = seedOrder(BUYER_ID, 'cbe');

      await promptReceiptUpload(makeCtx(BUYER_ID), order.id);

      const text = sentTexts.join('\n');
      expect(text).toContain(receiptReferenceExample('cbe').example);
      expect(text).toContain('for CBE');
      expect(text).not.toMatch(RETIRED_FT_FORMAT);
    });

    it('shows the Telebirr example to a Telebirr buyer, in English', async () => {
      const order = seedOrder(BUYER_ID, 'telebirr');

      await promptReceiptUpload(makeCtx(BUYER_ID), order.id);

      const text = sentTexts.join('\n');
      expect(text).toContain(receiptReferenceExample('telebirr').example);
      expect(text).toContain('for Telebirr');
      // Must not show the CBE token to a Telebirr buyer, or vice versa.
      expect(text).not.toContain(receiptReferenceExample('cbe').example);
      expect(text).not.toMatch(RETIRED_FT_FORMAT);
    });

    it('keeps the Amharic template intact and swaps only the example token', async () => {
      const order = seedOrder(BUYER_ID_AM, 'cbe', 'am');

      await promptReceiptUpload(makeCtx(BUYER_ID_AM, 'am'), order.id);

      const text = sentTexts.join('\n');
      // Amharic body untouched: both the heading and the bullet lead-ins survive.
      expect(text).toContain('የክፍያ ማረጋገጫ ይላኩ');
      expect(text).toContain('ቁጥሩን ብቻ ይፃፉ');
      expect(text).toContain('ለ ');
      expect(text).toContain(' ምሳሌ፦');
      // The rail name is substituted in ASCII, so the Amharic frame stays put.
      expect(text).toContain(receiptReferenceExample('cbe').example);
      expect(text).not.toMatch(RETIRED_FT_FORMAT);
    });

    it('names the right rail in the Amharic template for a Telebirr buyer', async () => {
      const order = seedOrder(BUYER_ID_AM, 'telebirr', 'am');

      await promptReceiptUpload(makeCtx(BUYER_ID_AM, 'am'), order.id);

      const text = sentTexts.join('\n');
      expect(text).toContain(`ለ ${receiptReferenceExample('telebirr').label} ምሳሌ፦`);
      expect(text).toContain(receiptReferenceExample('telebirr').example);
      expect(text).not.toMatch(RETIRED_FT_FORMAT);
    });
  });

  describe('retry guidance after an unreadable paste', () => {
    /** Arms the receipt session and sends text the ingester cannot extract a ref from. */
    async function sendUnreadable(userId: number, lang = 'en') {
      const replies: string[] = [];
      const ctx: any = {
        from: { id: userId, language_code: lang },
        message: { text: 'I already paid, please just check' },
        reply: async (msg: string) => {
          replies.push(msg);
        },
        api: { sendMessage: async () => ({}), sendPhoto: async () => ({}) },
      };
      await handleTextInput(ctx);
      return replies.join('\n');
    }

    it('uses the rail the order is on, in English', async () => {
      const order = seedOrder(BUYER_ID, 'cbe');
      setPendingAction(BUYER_ID, {
        type: 'user_receipt_upload',
        data: { orderId: order.id, attempts: 0 },
      });

      const text = await sendUnreadable(BUYER_ID);

      expect(text).toContain('Could not find a transaction reference');
      expect(text).toContain(receiptReferenceExample('cbe').example);
      expect(text).not.toMatch(RETIRED_FT_FORMAT);
    });

    it('uses the Telebirr example for a Telebirr order, in English', async () => {
      const order = seedOrder(BUYER_ID, 'telebirr');
      setPendingAction(BUYER_ID, {
        type: 'user_receipt_upload',
        data: { orderId: order.id, attempts: 0 },
      });

      const text = await sendUnreadable(BUYER_ID);

      expect(text).toContain(receiptReferenceExample('telebirr').example);
      expect(text).not.toMatch(RETIRED_FT_FORMAT);
    });

    it('leaves the Amharic retry copy intact apart from the example token', async () => {
      const order = seedOrder(BUYER_ID_AM, 'cbe', 'am');
      setPendingAction(BUYER_ID_AM, {
        type: 'user_receipt_upload',
        data: { orderId: order.id, attempts: 0 },
      });

      const text = await sendUnreadable(BUYER_ID_AM, 'am');

      expect(text).toContain('የትራንዛክሽን ቁጥር ማግኘት አልተቻለም');
      expect(text).toContain('ለምሳሌ፦');
      expect(text).toContain(receiptReferenceExample('cbe').example);
      expect(text).not.toMatch(RETIRED_FT_FORMAT);
    });
  });
});