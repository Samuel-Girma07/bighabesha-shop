import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createBot } from '../src/bot/bot.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { upsertUser } from '../src/bot/handlers/start.js';
import { getMainMenuKeyboard, addStyledInlineButton } from '../src/bot/keyboards/menu.js';
import { InlineKeyboard } from 'grammy';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Bot Core & Handlers', () => {
  beforeEach(() => {
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = '111111,222222';
    const migrationsDir = path.join(__dirname, '../src/db/migrations');
    initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('creates a bot instance successfully with valid token', () => {
    const bot = createBot('123456789:ABCdefGHIjklMNOpqrSTUvwxYZ');
    expect(bot).toBeDefined();
    expect(bot.token).toBe('123456789:ABCdefGHIjklMNOpqrSTUvwxYZ');
  });

  it('upserts regular users and assigns non-admin status', () => {
    const res = upsertUser({
      id: 999999,
      username: 'habeshatester',
      first_name: 'Habesha',
      last_name: 'Buyer',
      language_code: 'en',
    });

    expect(res.is_admin).toBe(false);
    expect(res.language_code).toBe('en');

    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(999999) as any;
    expect(user).toBeDefined();
    expect(user.username).toBe('habeshatester');
    expect(user.is_admin).toBe(0);
  });

  it('detects admin users and assigns is_admin = 1', () => {
    const res = upsertUser({
      id: 111111,
      username: 'superadmin',
      first_name: 'Admin',
      language_code: 'en',
    });

    expect(res.is_admin).toBe(true);

    const db = getDatabase();
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(111111) as any;
    expect(user.is_admin).toBe(1);
  });

  it('generates styled persistent reply keyboard with My Account and Main Menu', () => {
    const keyboard = getMainMenuKeyboard();
    const buttons = keyboard.keyboard;

    expect(buttons.length).toBeGreaterThan(0);
    const row = buttons[0];
    expect(row[0].text).toContain('My Account');
    expect((row[0] as any).style).toBe('success');
    expect(row[1].text).toContain('Main Menu');
    expect((row[1] as any).style).toBe('primary');

    const amKeyboard = getMainMenuKeyboard('am');
    const amRow = amKeyboard.keyboard[0];
    expect(amRow[0].text).toContain('👤 የእኔ መረጃ');
    expect(amRow[1].text).toContain('🏠 ዋና ማውጫ');
  });

  it('correctly constructs styled inline buttons with colors', () => {
    const inlineKb = new InlineKeyboard();
    addStyledInlineButton(inlineKb, {
      text: '✦ Gemini Pro 18M — 1,500 ETB',
      callback_data: 'prod_gemini_pro_18m',
      style: 'success',
    });
    addStyledInlineButton(inlineKb, {
      text: '⭐ Telegram Premium',
      callback_data: 'prod_telegram_premium',
      style: 'primary',
    });

    const rows = inlineKb.inline_keyboard;
    expect(rows[0][0].text).toBe('✦ Gemini Pro 18M — 1,500 ETB');
    expect((rows[0][0] as any).style).toBe('success');
    expect(rows[0][1].text).toBe('⭐ Telegram Premium');
    expect((rows[0][1] as any).style).toBe('primary');
  });

  it('checkout keyboard contains strictly Telebirr, CBE Bank, and Bank of Abyssinia (no decommissioned rails)', async () => {
    const { renderPaymentRailSelection } = await import('../src/bot/handlers/checkout.js');
    const { createOrder } = await import('../src/services/orders.service.js');

    const order = createOrder({
      userId: 999999,
      username: 'habeshatester',
      productId: 'gemini_pro_18m',
      amountETB: 1500,
      paymentRail: 'telebirr',
    });

    let renderedKeyboard: any = null;
    let renderedText = '';
    const mockCtx: any = {
      callbackQuery: {
        message: {},
      },
      editMessageText: async (text: string, options: any) => {
        renderedText = text;
        renderedKeyboard = options?.reply_markup;
      },
    };

    await renderPaymentRailSelection(mockCtx, order, 'Gemini Pro 18M');

    expect(renderedText).toContain('Order Ref');
    expect(renderedKeyboard).toBeDefined();

    const flatButtons = renderedKeyboard.inline_keyboard.flat();
    const buttonTexts = flatButtons.map((b: any) => b.text);
    const callbackDatas = flatButtons.map((b: any) => b.callback_data);

    // Active rails present
    expect(buttonTexts.some((t: string) => t.includes('Telebirr'))).toBe(true);
    expect(buttonTexts.some((t: string) => t.includes('CBE Bank'))).toBe(true);
    expect(buttonTexts.some((t: string) => t.includes('Bank of Abyssinia'))).toBe(true);

    // Exact callback data prefixes
    expect(callbackDatas).toContain(`pay_manual_telebirr_${order.id}`);
    expect(callbackDatas).toContain(`pay_manual_cbe_${order.id}`);
    expect(callbackDatas).toContain(`pay_manual_abyssinia_${order.id}`);

    // Strictly NO decommissioned rails present (chapa, wallet_pay, ton_connect)
    expect(callbackDatas.some((cb: string) => cb.includes('chapa'))).toBe(false);
    expect(callbackDatas.some((cb: string) => cb.includes('wallet_pay'))).toBe(false);
    expect(callbackDatas.some((cb: string) => cb.includes('ton'))).toBe(false);
    expect(buttonTexts.some((t: string) => /chapa|wallet|ton/i.test(t))).toBe(false);
  });
});

