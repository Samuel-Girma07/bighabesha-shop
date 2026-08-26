import { CallbackQueryContext, Context, InlineKeyboard, InputFile } from 'grammy';
import { getAllProducts, getProductById, getProductVariants, formatPriceETB, getVariantById } from '../../services/catalog.service.js';
import { getAvailableStockCount } from '../../services/stock.service.js';
import { getNumericSetting } from '../../services/settings.service.js';
import { setPendingAction } from '../session.js';
import { t } from '../../i18n/index.js';
import { getBannerPngPath } from '../../services/banner_generator.service.js';
import { logger } from '../../logger/index.js';

export async function renderCatalog(ctx: Context): Promise<void> {
  const products = getAllProducts();
  const keyboard = new InlineKeyboard();

  // All displayed "from" prices are derived from live catalog data — never
  // hardcoded, so admin price edits are reflected instantly.
  const minVariantPrice = (productId: string): number => {
    const prices = getProductVariants(productId).map((v) => v.price_etb);
    return prices.length > 0 ? Math.min(...prices) : 0;
  };
  const premiumFromPrice = minVariantPrice('telegram_premium');
  const starsFromPrice = minVariantPrice('telegram_stars');

  let text =
    '<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n' +
    '🛍 <b>Official Catalog & Subscription Services</b>\n\n' +
    '<blockquote>⚡ <i>Select a service below to view pricing, features, and instant automated delivery options:</i></blockquote>\n\n';

  for (const prod of products) {
    if (prod.type === 'stock') {
      const stock = getAvailableStockCount(prod.id);
      const variants = getProductVariants(prod.id);
      const price = variants[0]?.price_etb || 0;
      const stockBadge = stock > 0 ? `🟢 In Stock (<code>${stock}</code> in vault)` : `🔴 <b>Sold Out</b>`;

      text += `• 🤖 <b>${prod.name}</b>\n` +
        `   └ 💰 <code>${formatPriceETB(price)}</code> · ${stockBadge}\n\n`;
      keyboard.text(`🤖 ${prod.name} • ${stock > 0 ? formatPriceETB(price) : 'Sold Out'}`, `prod_${prod.id}`).row();
    } else if (prod.id === 'telegram_premium') {
      const fromLabel = premiumFromPrice > 0 ? formatPriceETB(premiumFromPrice) : 'price on request';
      text += `• ⭐ <b>${prod.name}</b>\n` +
        `   └ 💰 from <code>${fromLabel}</code> · ⚡ <i>3, 6, 12M Plans · Direct Gift</i>\n\n`;
      keyboard.text(`⭐ ${prod.name} • from ${fromLabel}`, `prod_${prod.id}`).row();
    } else if (prod.id === 'telegram_stars') {
      const fromLabel = starsFromPrice > 0 ? formatPriceETB(starsFromPrice) : 'price on request';
      text += `• 🪙 <b>${prod.name}</b>\n` +
        `   └ 💰 from <code>${fromLabel}</code> · ⚡ <i>Instant Fragment Top-Up</i>\n\n`;
      keyboard.text(`🪙 ${prod.name} • from ${fromLabel}`, `prod_${prod.id}`).row();
    } else {
      keyboard.text(`✨ ${prod.name}`, `prod_${prod.id}`).row();
    }
  }

  keyboard.row().text('« Main Menu', 'nav_home').text('📦 My Orders', 'nav_orders');

  if (ctx.callbackQuery?.message?.photo) {
    try {
      await ctx.editMessageMedia({
        type: 'photo',
        media: new InputFile(getBannerPngPath('welcome')),
        caption: text,
        parse_mode: 'HTML',
      }, { reply_markup: keyboard });
      return;
    } catch {}
  }

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    try {
      await ctx.replyWithPhoto(new InputFile(getBannerPngPath('welcome')), {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
  }
}

export async function renderProductDetails(ctx: Context, productId: string): Promise<void> {
  const product = getProductById(productId);
  if (!product) {
    await ctx.reply('Product not found.');
    return;
  }

  const keyboard = new InlineKeyboard();
  let bannerType: 'gemini' | 'premium' | 'stars' = 'gemini';
  let text = '';

  if (product.type === 'stock') {
    bannerType = 'gemini';
    const stock = getAvailableStockCount(product.id);
    const variants = getProductVariants(product.id);
    const variant = variants[0];
    const price = variant?.price_etb || 0;

    text = `<b>🤖 ${product.name}</b>\n\n` +
      `<blockquote>${product.description}</blockquote>\n\n` +
      `📊 <b>Product Specifications:</b>\n` +
      `• 💰 <b>Price:</b> <code>${formatPriceETB(price)}</code> (~83.3 ETB/month)\n` +
      `• 💾 <b>Storage:</b> <code>2,048 GB (2 TB)</code> Google One\n` +
      `• 📦 <b>Availability:</b> ${stock > 0 ? `🟢 In Stock (<code>${stock}</code> links ready)` : '🔴 <b>Currently Sold Out</b>'}\n` +
      `• ⚡ <b>Fulfillment:</b> Instant single-use activation link\n\n` +
      `<i>🛡️ 100% genuine Google workspace link with 18-month warranty.</i>`;

    if (stock > 0 && variant) {
      keyboard.text(`⚡ Purchase Plan — ${formatPriceETB(price)}`, `buy_var_${variant.id}`).row();
    } else {
      keyboard.text('🚫 Currently Sold Out', 'action_sold_out').row();
    }
  } else if (product.id === 'telegram_premium') {
    bannerType = 'premium';
    const variants = getProductVariants(product.id);

    text = `<b>⭐ ${product.name}</b>\n\n` +
      `<blockquote>${product.description}</blockquote>\n\n` +
      `✨ <b>Premium Features Included:</b>\n` +
      `• 🚀 Double Limits (Channels, Folders, Pinned Chats)\n` +
      `• 📁 4 GB File Uploads & Ultra-Fast Download Speed\n` +
      `• 🎙️ Voice-to-Text Audio Transcription\n` +
      `• 💎 Premium Star Badge & Custom Animated Emoji\n` +
      `• 🚫 100% Ad-Free Telegram Experience\n\n` +
      `👇 <b>Select your subscription duration:</b>`;

    for (const v of variants) {
      const badge = v.id.includes('12m') ? ' 🔥' : '';
      keyboard.text(`⭐ ${v.name} — ${formatPriceETB(v.price_etb)}${badge}`, `buy_var_${v.id}`).row();
    }
  } else if (product.id === 'telegram_stars') {
    bannerType = 'stars';
    const variants = getProductVariants(product.id);
    const etbPerStar = getNumericSetting('etb_per_star', 2.5);
    const minStars = getNumericSetting('stars_min', 10);
    const maxStars = getNumericSetting('stars_max', 100000);

    text = `<b>🪙 ${product.name}</b>\n\n` +
      `<blockquote>${product.description}</blockquote>\n\n` +
      `📊 <b>Pricing & Rates:</b>\n` +
      `• 💱 <b>Exchange Rate:</b> <code>1 Star = ${etbPerStar} ETB</code>\n` +
      `• 📐 <b>Custom Purchase Limits:</b> <code>${minStars.toLocaleString()} – ${maxStars.toLocaleString()} Stars</code>\n` +
      `• ⚡ <b>Delivery:</b> Instant Fragment credit to @username\n\n` +
      `👇 <b>Choose a package or enter a custom amount:</b>`;

    for (let i = 0; i < variants.length; i += 2) {
      const v1 = variants[i];
      const v2 = variants[i + 1];

      if (v1 && v2) {
        keyboard.text(`⭐️ ${v1.name} (${formatPriceETB(v1.price_etb)})`, `buy_var_${v1.id}`);
        keyboard.text(`⭐️ ${v2.name} (${formatPriceETB(v2.price_etb)})`, `buy_var_${v2.id}`).row();
      } else if (v1) {
        keyboard.text(`⭐️ ${v1.name} (${formatPriceETB(v1.price_etb)})`, `buy_var_${v1.id}`).row();
      }
    }

    keyboard.row().text('✏️ Enter Custom Stars Amount', 'stars_custom').row();
  }

  keyboard.row().text('« Back to Catalog', 'nav_shop').text('« Main Menu', 'nav_home');

  const bannerPath = getBannerPngPath(bannerType);

  if (ctx.callbackQuery?.message?.photo) {
    try {
      await ctx.editMessageMedia({
        type: 'photo',
        media: new InputFile(bannerPath),
        caption: text,
        parse_mode: 'HTML',
      }, { reply_markup: keyboard });
      return;
    } catch {}
  }

  if (ctx.callbackQuery) {
    try {
      await ctx.replyWithPhoto(new InputFile(bannerPath), {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      await ctx.deleteMessage().catch(() => {});
    } catch {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
  } else {
    try {
      await ctx.replyWithPhoto(new InputFile(bannerPath), {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
  }
}

export async function promptCustomStars(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const etbPerStar = getNumericSetting('etb_per_star', 2.5);
  const minStars = getNumericSetting('stars_min', 10);
  const maxStars = getNumericSetting('stars_max', 100000);

  setPendingAction(userId, {
    type: 'stars_custom_amount',
    data: { minStars, maxStars, etbPerStar },
  });

  const text = `<b>🪙 Custom Telegram Stars Purchase</b>\n\n` +
    `<blockquote>Enter the exact number of Stars you wish to purchase:</blockquote>\n\n` +
    `📊 <b>Purchase Limits & Rates:</b>\n` +
    `• 🔻 <b>Minimum:</b> <code>${minStars.toLocaleString()} Stars</code> (${formatPriceETB(Math.ceil(minStars * etbPerStar))})\n` +
    `• 🔺 <b>Maximum:</b> <code>${maxStars.toLocaleString()} Stars</code> (${formatPriceETB(Math.ceil(maxStars * etbPerStar))})\n` +
    `• 💱 <b>Rate:</b> <code>1 Star = ${etbPerStar} ETB</code>\n\n` +
    `💬 <i>Please type the number of Stars in chat (e.g. <code>750</code>):</i>`;

  const keyboard = new InlineKeyboard().text('« Cancel & Return', 'prod_telegram_stars');

  if (ctx.callbackQuery?.message?.photo) {
    await ctx.editMessageCaption({
      caption: text,
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } else if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export function validateCustomStarsAmount(
  input: string,
  minStars: number,
  maxStars: number
): { valid: boolean; stars?: number; error?: string } {
  const clean = input.trim().replace(/,/g, '');
  const num = parseInt(clean, 10);

  if (isNaN(num) || !/^\d+$/.test(clean)) {
    return { valid: false, error: 'Please enter a valid whole number without letters or decimals.' };
  }

  if (num < minStars) {
    return { valid: false, error: `The minimum purchase amount is ${minStars.toLocaleString()} Stars.` };
  }

  if (num > maxStars) {
    return { valid: false, error: `The maximum purchase amount is ${maxStars.toLocaleString()} Stars.` };
  }

  return { valid: true, stars: num };
}
