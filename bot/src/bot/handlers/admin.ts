import { Context, InlineKeyboard } from 'grammy';
import { getConfig } from '../../config/env.js';
import { getAllProducts, getProductById, getProductVariants, getVariantById, formatPriceETB, updateVariantPrice, setProductActive } from '../../services/catalog.service.js';
import { getTotalStockCount } from '../../services/stock.service.js';
import { getAllSettings, getNumericSetting, getSetting, setSetting } from '../../services/settings.service.js';
import { setPendingAction } from '../session.js';

export function isAdmin(userId?: number): boolean {
  if (!userId) return false;
  const config = getConfig();
  return config.ADMIN_IDS.includes(userId);
}

export async function renderAdminMenu(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId)) {
    await ctx.reply('⛔ Access denied: You are not authorized to view the admin dashboard.');
    return;
  }

  const text = '⚙️ *Bighabesha Shop — Admin Control Panel*\n\n' +
    'Select a section to manage products, fulfillment queue, stock inventory, exchange rates, broadcast announcements, and store settings:';

  const keyboard = new InlineKeyboard()
    .text('📋 Orders Queue', 'admin_orders_queue')
    .text('📦 Products & Prices', 'admin_products')
    .row()
    .text('🔑 Stock Management', 'admin_stock')
    .text('📈 Rates & Exchange', 'admin_rates')
    .row()
    .text('📢 Broadcast Announcement', 'admin_broadcast')
    .text('🏦 Settings & Accounts', 'admin_settings')
    .row()
    .text('« Exit Admin Mode', 'nav_home');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function renderAdminProducts(ctx: Context): Promise<void> {
  if (!isAdmin(ctx.from?.id)) return;

  const products = getAllProducts(true);
  const keyboard = new InlineKeyboard();

  let text = '📦 *Manage Products & Prices*\n\n' +
    'Tap any variant below to modify its price in ETB:\n\n';

  for (const prod of products) {
    const statusIcon = prod.is_active ? '🟢 Active' : '🔴 Disabled';
    text += `*${prod.name}* [${statusIcon}]\n`;

    const variants = getProductVariants(prod.id, true);
    for (const v of variants) {
      text += `  • ${v.name}: ${formatPriceETB(v.price_etb)}\n`;
      keyboard.text(`✏️ ${prod.name.split(' ')[0]} - ${v.name} (${v.price_etb} ETB)`, `admin_edit_var_${v.id}`).row();
    }
    text += '\n';
  }

  keyboard.text('« Back to Admin Menu', 'admin_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function promptEditVariantPrice(ctx: Context, variantId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId) || !userId) return;

  const variant = getVariantById(variantId);
  if (!variant) {
    await ctx.reply('Variant not found.');
    return;
  }

  setPendingAction(userId, {
    type: 'admin_edit_variant_price',
    data: { variantId, currentPrice: variant.price_etb, name: variant.name },
  });

  const text = `✏️ *Edit Price for "${variant.name}"*\n\n` +
    `Current Price: *${formatPriceETB(variant.price_etb)}*\n\n` +
    `💬 _Please send the new price in ETB as an integer (e.g. \`1600\`):_`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', 'admin_products');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function renderAdminStock(ctx: Context): Promise<void> {
  if (!isAdmin(ctx.from?.id)) return;

  const geminiStock = getTotalStockCount('gemini_pro_18m');
  const threshold = getNumericSetting('low_stock_threshold', 5);

  const text = '🔑 *Stock Inventory Management*\n\n' +
    '🤖 *Gemini Pro (18 Months)*\n' +
    `• Available Unused Links: *${geminiStock.available}*\n` +
    `• Delivered Orders: *${geminiStock.allocated}*\n` +
    `• Total Uploaded: *${geminiStock.total}*\n` +
    `• Low-Stock Alert Threshold: *${threshold}*\n\n` +
    'Choose an action below to restock:';

  const keyboard = new InlineKeyboard()
    .text('➕ Paste Activation Links', 'admin_stock_paste_gemini_pro_18m')
    .row()
    .text('📄 Upload CSV File', 'admin_stock_csv_gemini_pro_18m')
    .row()
    .text('« Back to Admin Menu', 'admin_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function promptStockPaste(ctx: Context, productId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId) || !userId) return;

  setPendingAction(userId, {
    type: 'admin_stock_single_paste',
    data: { productId },
  });

  const text = `➕ *Paste Activation Links*\n\n` +
    `Send one or multiple activation links in chat.\n\n` +
    `_You can paste multiple links on separate lines. Each line will be added as a separate available stock item._`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', 'admin_stock');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function promptStockCSV(ctx: Context, productId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId) || !userId) return;

  setPendingAction(userId, {
    type: 'admin_stock_csv_paste',
    data: { productId },
  });

  const text = `📄 *Upload Stock CSV File*\n\n` +
    `Please upload a \`.csv\` or \`.txt\` document containing activation links, or paste the raw CSV content directly into the chat.\n\n` +
    `_Format: one link per row or CSV with a \`link\` column header._`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', 'admin_stock');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function renderAdminRates(ctx: Context): Promise<void> {
  if (!isAdmin(ctx.from?.id)) return;

  const etbPerUsd = getNumericSetting('etb_per_usd', 135);
  const etbPerStar = getNumericSetting('etb_per_star', 2.5);
  const marginPct = getNumericSetting('margin_pct', 5);
  const starsMin = getNumericSetting('stars_min', 10);
  const starsMax = getNumericSetting('stars_max', 100000);

  const text = '📈 *Exchange Rates & Pricing Parameters*\n\n' +
    `• *ETB per USD:* ${etbPerUsd} ETB\n` +
    `• *ETB per Star:* ${etbPerStar} ETB\n` +
    `• *Crypto Margin:* ${marginPct}%\n` +
    `• *Min Custom Stars:* ${starsMin.toLocaleString()} ⭐\n` +
    `• *Max Custom Stars:* ${starsMax.toLocaleString()} ⭐\n\n` +
    'Tap a parameter to edit its value:';

  const keyboard = new InlineKeyboard()
    .text(`✏️ ETB/USD (${etbPerUsd})`, 'admin_edit_setting_etb_per_usd')
    .text(`✏️ ETB/Star (${etbPerStar})`, 'admin_edit_setting_etb_per_star')
    .row()
    .text(`✏️ Margin % (${marginPct}%)`, 'admin_edit_setting_margin_pct')
    .row()
    .text(`✏️ Min Stars (${starsMin})`, 'admin_edit_setting_stars_min')
    .text(`✏️ Max Stars (${starsMax})`, 'admin_edit_setting_stars_max')
    .row()
    .text('« Back to Admin Menu', 'admin_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function renderAdminSettings(ctx: Context): Promise<void> {
  if (!isAdmin(ctx.from?.id)) return;

  const cbeAccount = getSetting('cbe_account', '1000510711258');
  const telebirrAccount = getSetting('telebirr_account', '0965579045');
  const abyssiniaAccount = getSetting('abyssinia_account', 'Abyssinia Bank Account');
  const lowStock = getNumericSetting('low_stock_threshold', 5);

  const text = '🏦 *Bank Accounts & General Settings*\n\n' +
    `• *CBE Account:* \`${cbeAccount}\`\n` +
    `• *Telebirr:* \`${telebirrAccount}\`\n` +
    `• *Bank of Abyssinia:* \`${abyssiniaAccount}\`\n` +
    `• *Low-Stock Alert Threshold:* ${lowStock}\n\n` +
    'Tap an item to edit its display information:';

  const keyboard = new InlineKeyboard()
    .text('✏️ Edit CBE Account', 'admin_edit_setting_cbe_account')
    .row()
    .text('✏️ Edit Telebirr Account', 'admin_edit_setting_telebirr_account')
    .row()
    .text('✏️ Edit Abyssinia Account', 'admin_edit_setting_abyssinia_account')
    .row()
    .text('✏️ Edit Low-Stock Alert Level', 'admin_edit_setting_low_stock_threshold')
    .row()
    .text('« Back to Admin Menu', 'admin_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function promptEditSetting(ctx: Context, settingKey: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId) || !userId) return;

  const currentVal = getSetting(settingKey, '');

  setPendingAction(userId, {
    type: 'admin_edit_setting',
    data: { settingKey, currentVal },
  });

  const text = `✏️ *Edit Setting: \`${settingKey}\`*\n\n` +
    `Current Value: *${currentVal}*\n\n` +
    `💬 _Please send the new value in chat:_`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', 'admin_settings');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}
