import { Context, InlineKeyboard, InlineQueryResultBuilder } from 'grammy';
import { getAllProducts, formatPriceETB } from '../../services/catalog.service.js';
import { getNumericSetting } from '../../services/settings.service.js';
import { getConfig } from '../../config/env.js';

export async function inlineQueryHandler(ctx: Context): Promise<void> {
  const query = ctx.inlineQuery?.query?.trim().toLowerCase() || '';
  const config = getConfig();
  const botUsername = 'Bighabesha_shopBot';
  const webAppUrl = config.WEBAPP_URL || 'https://capabilities-aims-modular-reward.trycloudflare.com';

  const products = getAllProducts();
  const results: any[] = [];

  const filtered = products.filter((p) =>
    !query ||
    p.name.toLowerCase().includes(query) ||
    p.id.toLowerCase().includes(query) ||
    p.description.toLowerCase().includes(query)
  );

  for (const prod of filtered) {
    if (prod.id === 'gemini_pro_18m') {
      const keyboard = new InlineKeyboard()
        .webApp('View in Web App', webAppUrl)
        .row()
        .url('Buy on Telegram Bot', `https://t.me/${botUsername}?start=prod_gemini_pro_18m`);

      const text = `*Gemini Pro (18 Months)*\n\n` +
        `• Price: *1,500 ETB* (~83.3 ETB/mo)\n` +
        `• Storage: 2TB Google Drive & Photos\n` +
        `• Delivery: Automated instant activation link\n\n` +
        `_Official subscription via Bighabesha Shop._`;

      const article = InlineQueryResultBuilder.article(
        'iq_gemini',
        'Gemini Pro (18 Months) — 1,500 ETB',
        {
          description: 'Google AI Suite + 2,048 GB Cloud Storage. Automated delivery.',
          reply_markup: keyboard,
        }
      ).text(text, { parse_mode: 'Markdown' });

      results.push(article);
    } else if (prod.id === 'telegram_premium') {
      const keyboard = new InlineKeyboard()
        .webApp('View in Web App', webAppUrl)
        .row()
        .url('Buy on Telegram Bot', `https://t.me/${botUsername}?start=prod_telegram_premium`);

      const text = `*Telegram Premium Subscription*\n\n` +
        `• 3 Months: 1,100 ETB\n` +
        `• 6 Months: 1,850 ETB\n` +
        `• 12 Months: 3,200 ETB (Save 400 ETB)\n\n` +
        `_Gifted directly to your public @username via Fragment._`;

      const article = InlineQueryResultBuilder.article(
        'iq_premium',
        'Telegram Premium (3, 6, 12 Months) — from 1,100 ETB',
        {
          description: 'Official Fragment direct gift to @username without password.',
          reply_markup: keyboard,
        }
      ).text(text, { parse_mode: 'Markdown' });

      results.push(article);
    } else if (prod.id === 'telegram_stars') {
      const etbPerStar = getNumericSetting('etb_per_star', 2.5);
      const keyboard = new InlineKeyboard()
        .webApp('Star Calculator (Web)', webAppUrl)
        .row()
        .url('Buy on Telegram Bot', `https://t.me/${botUsername}?start=prod_telegram_stars`);

      const text = `*Telegram Stars (Coins)*\n\n` +
        `• Rate: *1 Star = ${etbPerStar} ETB*\n` +
        `• 100 Stars: 250 ETB\n` +
        `• 500 Stars: 1,250 ETB\n` +
        `• 1,000 Stars: 2,500 ETB\n\n` +
        `_Instant account crediting via Fragment rails._`;

      const article = InlineQueryResultBuilder.article(
        'iq_stars',
        `Telegram Stars (Coins) — Rate: 1 Star = ${etbPerStar} ETB`,
        {
          description: 'In-app currency for digital gifts, channel boosts, and bots.',
          reply_markup: keyboard,
        }
      ).text(text, { parse_mode: 'Markdown' });

      results.push(article);
    }
  }

  // Add General Store card
  const generalKeyboard = new InlineKeyboard()
    .webApp('Open Web App Store', webAppUrl)
    .row()
    .url('Open Telegram Bot', `https://t.me/${botUsername}`);

  const generalText = `*Welcome to Bighabesha Shop*\n\n` +
    `Official Ethiopian store for Gemini Pro, Telegram Premium, and Telegram Stars.\n\n` +
    `• Telebirr, CBE Bank, Bank of Abyssinia\n` +
    `• Telegram Stars & TON/USDT Crypto\n\n` +
    `Open the catalog below to order:`;

  const generalArticle = InlineQueryResultBuilder.article(
    'iq_store_main',
    'Bighabesha Shop — Official Digital Store',
    {
      description: 'Browse all subscriptions, pricing, and Ethiopian payment rails.',
      reply_markup: generalKeyboard,
    }
  ).text(generalText, { parse_mode: 'Markdown' });

  results.push(generalArticle);

  await ctx.answerInlineQuery(results, {
    cache_time: 10,
    is_personal: false,
  });
}
