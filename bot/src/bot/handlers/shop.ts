import { Context, InlineKeyboard, InputFile } from 'grammy';
import { getAllProducts, getProductById, getProductVariants, formatPriceETB } from '../../services/catalog.service.js';
import { getAvailableStockCount } from '../../services/stock.service.js';
import { getBannerPngPath } from '../../services/banner_generator.service.js';
import { addStyledInlineButton } from '../keyboards/menu.js';

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
      addStyledInlineButton(keyboard, {
        text: `✦ ${prod.name} • ${stock > 0 ? formatPriceETB(price) : 'Sold Out'}`,
        callback_data: `prod_${prod.id}`,
        style: 'success',
      }).row();
    } else if (prod.id === 'telegram_premium') {
      const fromLabel = premiumFromPrice > 0 ? formatPriceETB(premiumFromPrice) : 'price on request';
      text += `• ⭐ <b>${prod.name}</b>\n` +
        `   └ 💰 from <code>${fromLabel}</code> · ⚡ <i>3, 6, 12M Plans · Direct Gift</i>\n\n`;
      addStyledInlineButton(keyboard, {
        text: `⭐ ${prod.name} • from ${fromLabel}`,
        callback_data: `prod_${prod.id}`,
        style: 'primary',
      }).row();
    } else {
      addStyledInlineButton(keyboard, {
        text: `✨ ${prod.name}`,
        callback_data: `prod_${prod.id}`,
        style: 'primary',
      }).row();
    }
  }

  addStyledInlineButton(keyboard, {
    text: '🏠 Main Menu',
    callback_data: 'nav_home',
    style: 'primary',
  });
  addStyledInlineButton(keyboard, {
    text: '📦 My Orders',
    callback_data: 'nav_orders',
    style: 'primary',
  }).row();

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
  let bannerType: 'gemini' | 'premium' = 'gemini';
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
      addStyledInlineButton(keyboard, {
        text: `⚡ Purchase Plan — ${formatPriceETB(price)}`,
        callback_data: `buy_var_${variant.id}`,
        style: 'success',
      }).row();
    } else {
      addStyledInlineButton(keyboard, {
        text: '🚫 Currently Sold Out',
        callback_data: 'action_sold_out',
        style: 'danger',
      }).row();
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
      const isBestValue = v.id.includes('12m');
      const badge = isBestValue ? ' 🔥' : '';
      addStyledInlineButton(keyboard, {
        text: `⭐ ${v.name} — ${formatPriceETB(v.price_etb)}${badge}`,
        callback_data: `buy_var_${v.id}`,
        style: isBestValue ? 'success' : 'primary',
      }).row();
    }
  }

  addStyledInlineButton(keyboard, {
    text: '« Back to Catalog',
    callback_data: 'nav_shop',
    style: 'primary',
  });
  addStyledInlineButton(keyboard, {
    text: '🏠 Main Menu',
    callback_data: 'nav_home',
    style: 'primary',
  }).row();

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

