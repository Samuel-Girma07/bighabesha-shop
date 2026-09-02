import { Context, InlineKeyboard, InlineQueryResultBuilder } from 'grammy';
import type { InlineQueryResult } from 'grammy/types';
import { getAllProducts } from '../../services/catalog.service.js';
import { getNumericSetting } from '../../services/settings.service.js';
import { getConfig } from '../../config/env.js';

export async function inlineQueryHandler(ctx: Context): Promise<void> {
  const query = ctx.inlineQuery?.query?.trim().toLowerCase() || '';
  const config = getConfig();
  const webAppUrl = config.WEBAPP_URL;
  const botUsername = ctx.me?.username || 'bighabesha_bot';

  const products = getAllProducts();
  const results: InlineQueryResult[] = [];

  const filtered = products.filter((p) =>
    !query ||
    p.name.toLowerCase().includes(query) ||
    p.id.toLowerCase().includes(query) ||
    p.description.toLowerCase().includes(query)
  );

  for (const prod of filtered) {
    if (prod.id === 'gemini_pro_18m') {
      const keyboard = new InlineKeyboard();
      if (webAppUrl) {
        keyboard.webApp('🚀 Launch Mini App Store', webAppUrl).row();
      }
      keyboard.url('🤖 Buy via Telegram Bot', `https://t.me/${botUsername}?start=prod_gemini_pro_18m`);

      const text =
        `<b>✨ Gemini Pro (18 Months) — 2TB Cloud</b>\n\n` +
        `<blockquote>Google AI Studio Pro Suite + 2,048 GB Google Drive Storage</blockquote>\n\n` +
        `• 💰 <b>Price:</b> <code>1,500 ETB</code> (~83.3 ETB/mo)\n` +
        `• ⚡ <b>Fulfillment:</b> Instant single-use activation link\n` +
        `• 🛡️ <b>Warranty:</b> 18 Months full replacement warranty\n\n` +
        `<i>Official subscription via Bighabesha Shop.</i>`;

      const article = InlineQueryResultBuilder.article(
        'iq_gemini',
        '🤖 Gemini Pro (18 Months) — 1,500 ETB',
        {
          description: 'Google AI Suite + 2,048 GB Cloud Storage. Automated instant delivery.',
          reply_markup: keyboard,
          ...(webAppUrl ? { thumbnail_url: `${webAppUrl}/banners/gemini.jpg`, thumbnail_width: 320, thumbnail_height: 180 } : {}),
        }
      ).text(text, { parse_mode: 'HTML' });

      results.push(article);
    } else if (prod.id === 'telegram_premium') {
      const keyboard = new InlineKeyboard();
      if (webAppUrl) {
        keyboard.webApp('🚀 Launch Mini App Store', webAppUrl).row();
      }
      keyboard.url('⭐ Buy via Telegram Bot', `https://t.me/${botUsername}?start=prod_telegram_premium`);

      const text =
        `<b>⭐ Telegram Premium Subscription</b>\n\n` +
        `<blockquote>Direct Fragment gift to @username without password</blockquote>\n\n` +
        `• <b>3 Months:</b> <code>1,100 ETB</code>\n` +
        `• <b>6 Months:</b> <code>1,850 ETB</code>\n` +
        `• <b>12 Months:</b> <code>3,200 ETB</code> 🔥 <i>(Save 400 ETB)</i>\n\n` +
        `<i>Gifted directly to your public @username via Fragment.</i>`;

      const article = InlineQueryResultBuilder.article(
        'iq_premium',
        '⭐ Telegram Premium (3, 6, 12 Months) — from 1,100 ETB',
        {
          description: 'Official Fragment direct gift to @username without password.',
          reply_markup: keyboard,
          ...(webAppUrl ? { thumbnail_url: `${webAppUrl}/banners/premium.jpg`, thumbnail_width: 320, thumbnail_height: 180 } : {}),
        }
      ).text(text, { parse_mode: 'HTML' });

      results.push(article);
    } else if (prod.id === 'telegram_stars') {
      const etbPerStar = getNumericSetting('etb_per_star', 2.5);
      const keyboard = new InlineKeyboard();
      if (webAppUrl) {
        keyboard.webApp('🪙 Star Calculator (Mini App)', webAppUrl).row();
      }
      keyboard.url('🪙 Buy Stars via Bot', `https://t.me/${botUsername}?start=prod_telegram_stars`);

      const text =
        `<b>🪙 Telegram Stars (In-App Currency)</b>\n\n` +
        `<blockquote>Direct account top-up for channel boosts, gifts & bots</blockquote>\n\n` +
        `• 💱 <b>Exchange Rate:</b> <code>1 Star = ${etbPerStar} ETB</code>\n` +
        `• ⭐️ <b>100 Stars:</b> <code>250 ETB</code>\n` +
        `• ⭐️ <b>500 Stars:</b> <code>1,250 ETB</code>\n` +
        `• ⭐️ <b>1,000 Stars:</b> <code>2,500 ETB</code>\n\n` +
        `<i>Instant account crediting via Fragment rails.</i>`;

      const article = InlineQueryResultBuilder.article(
        'iq_stars',
        `🪙 Telegram Stars — Rate: 1 Star = ${etbPerStar} ETB`,
        {
          description: 'In-app currency for digital gifts, channel boosts, and bots.',
          reply_markup: keyboard,
          ...(webAppUrl ? { thumbnail_url: `${webAppUrl}/banners/stars.jpg`, thumbnail_width: 320, thumbnail_height: 180 } : {}),
        }
      ).text(text, { parse_mode: 'HTML' });

      results.push(article);
    }
  }

  // Add General Store card
  const generalKeyboard = new InlineKeyboard();
  if (webAppUrl) {
    generalKeyboard.webApp('🚀 Open Mini App Store', webAppUrl).row();
  }
  generalKeyboard.url('🛍️ Open Telegram Bot', `https://t.me/${botUsername}`);

  const generalText =
    `<b>✨ Welcome to Bighabesha Shop</b>\n\n` +
    `<blockquote>Official Ethiopian marketplace for Gemini Pro, Telegram Premium, and Telegram Stars.</blockquote>\n\n` +
    `• 💳 <b>Domestic Rails:</b> Telebirr, CBE Bank, Bank of Abyssinia\n` +
    `• 🌐 <b>Digital & Crypto:</b> Telegram Stars (XTR) & TON / USDT\n\n` +
    `<i>Tap below to open the catalog or launch the Mini App:</i>`;

  const generalArticle = InlineQueryResultBuilder.article(
    'iq_store_main',
    '✨ Bighabesha Shop — Official Digital Store',
    {
      description: 'Browse all subscriptions, pricing, and Ethiopian payment rails.',
      reply_markup: generalKeyboard,
      ...(webAppUrl ? { thumbnail_url: `${webAppUrl}/banners/welcome.jpg`, thumbnail_width: 320, thumbnail_height: 180 } : {}),
    }
  ).text(generalText, { parse_mode: 'HTML' });

  results.push(generalArticle);

  await ctx.answerInlineQuery(results, {
    cache_time: 10,
    is_personal: false,
  });
}

