/**
 * Regression tests: storefront/menu consistency between the mini app and the bot,
 * and admin panel reachability from photo (banner) messages.
 *
 * Background:
 *  - The main menu hardcoded a purchasable Gemini Pro button with no stock check,
 *    while the catalog and mini app both gate out-of-stock products.
 *  - Handlers that called ctx.editMessageText() unconditionally silently no-op'd
 *    when the originating message was a photo (Telegram forbids text edits on
 *    media messages) — this made the inline Admin Panel entry appear "dead".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { startHandler } from '../src/bot/handlers/start.js';
import { renderCatalog } from '../src/bot/handlers/shop.js';
import { renderAdminMenu, renderAdminStock, renderAdminSettings } from '../src/bot/handlers/admin.js';
import { renderAdminOrdersQueue } from '../src/bot/handlers/admin_queue.js';
import { renderProfile } from '../src/bot/handlers/profile.js';
import { renderMyOrders } from '../src/bot/handlers/orders.js';
import { renderSupport } from '../src/bot/handlers/support.js';
import { upsertUser, saveUserPhone } from '../src/services/users.service.js';
import { addStockLink, getAvailableStockCount } from '../src/services/stock.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

const ADMIN_ID = 111111111;
const USER_ID = 424242;

beforeEach(() => {
  process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
  process.env.ADMIN_IDS = String(ADMIN_ID);
  initDatabase(':memory:', migrationsDir);
  upsertUser({ id: USER_ID, username: 'buyer', first_name: 'Buyer', language_code: 'en' });
  saveUserPhone(USER_ID, '+251911111111');
  upsertUser({ id: ADMIN_ID, username: 'admin', first_name: 'Admin', language_code: 'en' });
  saveUserPhone(ADMIN_ID, '+251922222222');
});

afterEach(() => {
  closeDatabase();
});

/** Minimal ctx for a plain (non-callback) invocation such as /start. */
function makeCommandCtx(userId: number) {
  const captured: { photoCaption?: string; photoKeyboard?: any; replies: string[] } = { replies: [] };
  const ctx: any = {
    from: { id: userId, username: 'tester', first_name: 'Tester' },
    match: '',
    reply: async (text: string) => { captured.replies.push(text); },
    replyWithPhoto: async (_photo: any, options: any) => {
      captured.photoCaption = options?.caption || '';
      captured.photoKeyboard = options?.reply_markup;
    },
    setChatMenuButton: async () => {},
  };
  return { ctx, captured };
}

/**
 * Minimal ctx for a callback originating from a PHOTO message. editMessageText
 * is rigged to throw exactly like the Telegram API does for media messages.
 */
function makePhotoCallbackCtx(userId: number, data: string) {
  const captured: { captionEdit?: any; textEditCalled: boolean; replies: string[] } = {
    textEditCalled: false,
    replies: [],
  };
  const ctx: any = {
    from: { id: userId, username: 'tester', first_name: 'Tester' },
    callbackQuery: {
      data,
      message: { photo: [{ file_id: 'photo_file_id' }] },
    },
    editMessageCaption: async (opts: any) => { captured.captionEdit = opts; },
    editMessageText: async () => {
      captured.textEditCalled = true;
      throw new Error('Bad Request: there is no text in the message to edit');
    },
    reply: async (text: string) => { captured.replies.push(text); },
    answerCallbackQuery: async () => {},
    deleteMessage: async () => {},
    api: { sendMessage: async () => {} },
  };
  return { ctx, captured };
}

function flatButtons(keyboard: any): any[] {
  return keyboard?.inline_keyboard?.flat() || [];
}

describe('Main menu stock consistency (dashboard ⇄ bot)', () => {
  it('shows an actionable Gemini Pro button when the vault has stock', async () => {
    addStockLink('gemini_pro_18m', 'https://gemini.google.com/redeem/consistency_token_1');
    expect(getAvailableStockCount('gemini_pro_18m')).toBe(1);

    const { ctx, captured } = makeCommandCtx(USER_ID);
    await startHandler(ctx, { skipChannelCheck: true });

    const buttons = flatButtons(captured.photoKeyboard);
    const gemini = buttons.find((b) => b.text.includes('Gemini Pro'));
    expect(gemini).toBeDefined();
    expect(gemini.callback_data).toBe('prod_gemini_pro_18m');
  });

  it('marks Gemini Pro as Sold Out (non-actionable) on the main menu when the vault is empty', async () => {
    expect(getAvailableStockCount('gemini_pro_18m')).toBe(0);

    const { ctx, captured } = makeCommandCtx(USER_ID);
    await startHandler(ctx, { skipChannelCheck: true });

    const buttons = flatButtons(captured.photoKeyboard);
    // No button may deep-link into checkout for an out-of-stock product
    expect(buttons.some((b) => b.callback_data === 'prod_gemini_pro_18m')).toBe(false);
    const soldOut = buttons.find((b) => b.callback_data === 'sold_out_gemini_pro_18m');
    expect(soldOut).toBeDefined();
    expect(soldOut.text).toContain('Sold Out');
  });

  it('keeps main menu and catalog sold-out behavior identical', async () => {
    // Catalog with empty vault renders sold_out_ callback; main menu must match.
    const { ctx, captured } = makeCommandCtx(USER_ID);
    await renderCatalog(ctx);
    const catalogButtons = flatButtons(captured.photoKeyboard);
    expect(catalogButtons.some((b) => b.callback_data === 'sold_out_gemini_pro_18m')).toBe(true);
    expect(catalogButtons.some((b) => b.callback_data === 'prod_gemini_pro_18m')).toBe(false);
  });

  it('main menu recovers the purchase button immediately after restock', async () => {
    const before = makeCommandCtx(USER_ID);
    await startHandler(before.ctx, { skipChannelCheck: true });
    expect(flatButtons(before.captured.photoKeyboard).some((b) => b.callback_data === 'sold_out_gemini_pro_18m')).toBe(true);

    addStockLink('gemini_pro_18m', 'https://gemini.google.com/redeem/consistency_token_2');

    const after = makeCommandCtx(USER_ID);
    await startHandler(after.ctx, { skipChannelCheck: true });
    const buttons = flatButtons(after.captured.photoKeyboard);
    expect(buttons.some((b) => b.callback_data === 'prod_gemini_pro_18m')).toBe(true);
    expect(buttons.some((b) => b.callback_data === 'sold_out_gemini_pro_18m')).toBe(false);
  });
});

describe('Admin panel reachable from photo (banner) messages', () => {
  it('renders the admin menu by editing the caption of a photo message', async () => {
    const { ctx, captured } = makePhotoCallbackCtx(ADMIN_ID, 'admin_menu');
    await renderAdminMenu(ctx);

    expect(captured.textEditCalled).toBe(false);
    expect(captured.captionEdit).toBeDefined();
    expect(captured.captionEdit.caption).toContain('Admin Control Panel');
    const buttons = flatButtons(captured.captionEdit.reply_markup);
    expect(buttons.some((b) => b.callback_data === 'admin_orders_queue')).toBe(true);
    expect(buttons.some((b) => b.callback_data === 'admin_stock')).toBe(true);
  });

  it('renders admin sub-panels from photo messages without throwing', async () => {
    for (const render of [renderAdminStock, renderAdminSettings, renderAdminOrdersQueue]) {
      const { ctx, captured } = makePhotoCallbackCtx(ADMIN_ID, 'admin_sub');
      await render(ctx);
      expect(captured.textEditCalled).toBe(false);
      expect(captured.captionEdit).toBeDefined();
    }
  });

  it('still ignores non-admin users entirely', async () => {
    const { ctx, captured } = makePhotoCallbackCtx(USER_ID, 'admin_menu');
    await renderAdminMenu(ctx);
    expect(captured.captionEdit).toBeUndefined();
    expect(captured.textEditCalled).toBe(false);
    expect(captured.replies.length).toBe(0);
  });
});

describe('Buyer navigation reachable from photo (banner) messages', () => {
  it('renders profile via caption edit when invoked from a photo message', async () => {
    const { ctx, captured } = makePhotoCallbackCtx(USER_ID, 'nav_profile');
    await renderProfile(ctx);
    expect(captured.textEditCalled).toBe(false);
    expect(captured.captionEdit).toBeDefined();
  });

  it('renders order history via caption edit when invoked from a photo message', async () => {
    const { ctx, captured } = makePhotoCallbackCtx(USER_ID, 'nav_orders');
    await renderMyOrders(ctx);
    expect(captured.textEditCalled).toBe(false);
    expect(captured.captionEdit).toBeDefined();
  });

  it('renders support desk via caption edit when invoked from a photo message', async () => {
    const { ctx, captured } = makePhotoCallbackCtx(USER_ID, 'nav_support');
    await renderSupport(ctx);
    expect(captured.textEditCalled).toBe(false);
    expect(captured.captionEdit).toBeDefined();
    // Support card must reflect the post-redesign rails only
    expect(captured.captionEdit.caption).toContain('Telebirr & CBE Bank');
    expect(captured.captionEdit.caption).not.toContain('Abyssinia');
  });
});
