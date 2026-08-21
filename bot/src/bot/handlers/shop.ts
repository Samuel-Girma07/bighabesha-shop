import { CallbackQueryContext, Context, InlineKeyboard } from 'grammy';
import { getAllProducts, getProductById, getProductVariants, formatPriceETB, getVariantById } from '../../services/catalog.service.js';
import { getAvailableStockCount } from '../../services/stock.service.js';
import { getNumericSetting } from '../../services/settings.service.js';
import { setPendingAction } from '../session.js';
import { t } from '../../i18n/index.js';

export async function renderCatalog(ctx: Context): Promise<void> {
  const products = getAllProducts();
  const keyboard = new InlineKeyboard();

  let text = '🛍 *Bighabesha Shop — Catalog*\n\n' +
    'Choose a product or service below to view pricing and options:\n\n';

  for (const prod of products) {
    if (prod.type === 'stock') {
      const stock = getAvailableStockCount(prod.id);
      const variants = getProductVariants(prod.id);
      const price = variants[0]?.price_etb || 0;
      const stockBadge = stock > 0 ? `(${stock} available)` : `(Sold Out ❌)`;

      text += `• *${prod.name}* — ${formatPriceETB(price)} _${stockBadge}_\n`;
      keyboard.text(`🤖 ${prod.name} ${stock > 0 ? `• ${formatPriceETB(price)}` : '• Sold Out ❌'}`, `prod_${prod.id}`).row();
    } else if (prod.id === 'telegram_premium') {
      text += `• *${prod.name}* — from 1,100 ETB _(3, 6, 12 Months)_\n`;
      keyboard.text(`⭐️ ${prod.name} • from 1,100 ETB`, `prod_${prod.id}`).row();
    } else if (prod.id === 'telegram_stars') {
      text += `• *${prod.name}* — from 125 ETB _(Packages & Custom)_\n`;
      keyboard.text(`🪙 ${prod.name} • from 125 ETB`, `prod_${prod.id}`).row();
    } else {
      keyboard.text(`📦 ${prod.name}`, `prod_${prod.id}`).row();
    }
  }

  keyboard.row().text('« Back to Main Menu', 'nav_home');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function renderProductDetails(ctx: Context, productId: string): Promise<void> {
  const product = getProductById(productId);
  if (!product) {
    await ctx.reply('Product not found.');
    return;
  }

  const keyboard = new InlineKeyboard();

  if (product.type === 'stock') {
    const stock = getAvailableStockCount(product.id);
    const variants = getProductVariants(product.id);
    const variant = variants[0];
    const price = variant?.price_etb || 0;

    let text = `🤖 *${product.name}*\n\n` +
      `${product.description}\n\n` +
      `💰 *Price:* ${formatPriceETB(price)}\n` +
      `📦 *Stock Status:* ${stock > 0 ? `✅ In Stock (${stock} available)` : '🚨 SOLD OUT'}\n\n` +
      `_Instant automated delivery after payment verification._`;

    if (stock > 0 && variant) {
      keyboard.text(`⚡ Buy Now — ${formatPriceETB(price)}`, `buy_var_${variant.id}`).row();
    } else {
      keyboard.text('❌ Currently Sold Out', 'action_sold_out').row();
    }

    keyboard.text('« Back to Catalog', 'nav_shop');

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  } else if (product.id === 'telegram_premium') {
    const variants = getProductVariants(product.id);

    let text = `⭐️ *${product.name}*\n\n` +
      `${product.description}\n\n` +
      `Select your subscription duration:`;

    for (const v of variants) {
      keyboard.text(`${v.name} — ${formatPriceETB(v.price_etb)}`, `buy_var_${v.id}`).row();
    }

    keyboard.text('« Back to Catalog', 'nav_shop');

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  } else if (product.id === 'telegram_stars') {
    const variants = getProductVariants(product.id);
    const etbPerStar = getNumericSetting('etb_per_star', 2.5);
    const minStars = getNumericSetting('stars_min', 10);
    const maxStars = getNumericSetting('stars_max', 100000);

    let text = `🪙 *${product.name}*\n\n` +
      `${product.description}\n\n` +
      `📊 *Current Rate:* 1 ⭐ = ${etbPerStar} ETB\n` +
      `🎯 *Custom Limits:* ${minStars.toLocaleString()} – ${maxStars.toLocaleString()} Stars\n\n` +
      `Choose a package or enter a custom amount:`;

    // 2 buttons per row for packages
    for (let i = 0; i < variants.length; i += 2) {
      const v1 = variants[i];
      const v2 = variants[i + 1];

      if (v1 && v2) {
        keyboard.text(`${v1.name} (${formatPriceETB(v1.price_etb)})`, `buy_var_${v1.id}`);
        keyboard.text(`${v2.name} (${formatPriceETB(v2.price_etb)})`, `buy_var_${v2.id}`).row();
      } else if (v1) {
        keyboard.text(`${v1.name} (${formatPriceETB(v1.price_etb)})`, `buy_var_${v1.id}`).row();
      }
    }

    keyboard.row().text('✨ Enter Custom Stars Amount', 'stars_custom').row();
    keyboard.text('« Back to Catalog', 'nav_shop');

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
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

  const text = `🪙 *Custom Telegram Stars Amount*\n\n` +
    `Enter the number of Stars you wish to purchase as a number.\n\n` +
    `• *Minimum:* ${minStars.toLocaleString()} ⭐ (${formatPriceETB(Math.ceil(minStars * etbPerStar))})\n` +
    `• *Maximum:* ${maxStars.toLocaleString()} ⭐ (${formatPriceETB(Math.ceil(maxStars * etbPerStar))})\n` +
    `• *Rate:* 1 ⭐ = ${etbPerStar} ETB\n\n` +
    `💬 _Please type the amount in chat (e.g. \`750\`):_`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', 'prod_telegram_stars');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
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
