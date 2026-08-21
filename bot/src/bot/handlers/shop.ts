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

  let text = '<b>Bighabesha Shop — Products Catalog</b>\n\n' +
    'Select a product or service below to view plans and pricing:\n\n';

  for (const prod of products) {
    if (prod.type === 'stock') {
      const stock = getAvailableStockCount(prod.id);
      const variants = getProductVariants(prod.id);
      const price = variants[0]?.price_etb || 0;
      const stockBadge = stock > 0 ? `(${stock} available)` : `(Sold Out)`;

      text += `• <b>${prod.name}</b> — ${formatPriceETB(price)} <i>${stockBadge}</i>\n`;
      keyboard.text(`${prod.name} ${stock > 0 ? `• ${formatPriceETB(price)}` : '• Sold Out'}`, `prod_${prod.id}`).row();
    } else if (prod.id === 'telegram_premium') {
      text += `• <b>${prod.name}</b> — from 1,100 ETB <i>(3, 6, 12 Months)</i>\n`;
      keyboard.text(`${prod.name} • from 1,100 ETB`, `prod_${prod.id}`).row();
    } else if (prod.id === 'telegram_stars') {
      text += `• <b>${prod.name}</b> — from 125 ETB <i>(Packages & Custom)</i>\n`;
      keyboard.text(`${prod.name} • from 125 ETB`, `prod_${prod.id}`).row();
    } else {
      keyboard.text(prod.name, `prod_${prod.id}`).row();
    }
  }

  keyboard.row().text('« Main Menu', 'nav_home');

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

    text = `<b>${product.name}</b>\n\n` +
      `${product.description}\n\n` +
      `• <b>Price:</b> ${formatPriceETB(price)}\n` +
      `• <b>Stock Status:</b> ${stock > 0 ? `Available (${stock} links in stock)` : 'Sold Out'}\n\n` +
      `<i>Automated instant link delivery upon payment confirmation.</i>`;

    if (stock > 0 && variant) {
      keyboard.text(`Purchase Plan — ${formatPriceETB(price)}`, `buy_var_${variant.id}`).row();
    } else {
      keyboard.text('Currently Sold Out', 'action_sold_out').row();
    }
  } else if (product.id === 'telegram_premium') {
    bannerType = 'premium';
    const variants = getProductVariants(product.id);

    text = `<b>${product.name}</b>\n\n` +
      `${product.description}\n\n` +
      `Select your subscription duration:`;

    for (const v of variants) {
      keyboard.text(`${v.name} — ${formatPriceETB(v.price_etb)}`, `buy_var_${v.id}`).row();
    }
  } else if (product.id === 'telegram_stars') {
    bannerType = 'stars';
    const variants = getProductVariants(product.id);
    const etbPerStar = getNumericSetting('etb_per_star', 2.5);
    const minStars = getNumericSetting('stars_min', 10);
    const maxStars = getNumericSetting('stars_max', 100000);

    text = `<b>${product.name}</b>\n\n` +
      `${product.description}\n\n` +
      `• <b>Exchange Rate:</b> 1 Star = ${etbPerStar} ETB\n` +
      `• <b>Custom Range:</b> ${minStars.toLocaleString()} – ${maxStars.toLocaleString()} Stars\n\n` +
      `Choose a package or enter a custom amount:`;

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

    keyboard.row().text('Enter Custom Stars Amount', 'stars_custom').row();
  }

  keyboard.text('« Back to Catalog', 'nav_shop');

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

  const text = `<b>Custom Telegram Stars Amount</b>\n\n` +
    `Enter the number of Stars you wish to purchase:\n\n` +
    `• Minimum: ${minStars.toLocaleString()} Stars (${formatPriceETB(Math.ceil(minStars * etbPerStar))})\n` +
    `• Maximum: ${maxStars.toLocaleString()} Stars (${formatPriceETB(Math.ceil(maxStars * etbPerStar))})\n` +
    `• Rate: 1 Star = ${etbPerStar} ETB\n\n` +
    `Please type the amount in chat (e.g. <code>750</code>):`;

  const keyboard = new InlineKeyboard().text('Cancel', 'prod_telegram_stars');

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
