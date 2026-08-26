import { Context, InlineKeyboard } from 'grammy';
import { getConfig } from '../../config/env.js';
import { ensureAdminRow, roleHasPermission, type Permission } from '../../auth/permissions.js';
import { getAllProducts, getProductById, getProductVariants, getVariantById, formatPriceETB, updateVariantPrice, setProductActive } from '../../services/catalog.service.js';
import { getTotalStockCount } from '../../services/stock.service.js';
import { getAllSettings, getNumericSetting, getSetting, setSetting } from '../../services/settings.service.js';
import { setPendingAction } from '../session.js';
import { escapeHtml } from '../../utils/html.js';

/**
 * Bot-side admin check with optional RBAC permission scoping.
 * - isAdmin(id)              → any active administrator
 * - isAdmin(id, 'stock.manage') → active admin whose role holds the permission
 */
export function isAdmin(userId?: number, perm?: Permission): boolean {
  if (!userId) return false;
  const config = getConfig();
  if (!config.ADMIN_IDS.includes(userId)) return false;

  const role = ensureAdminRow(userId);
  if (!role) return false;
  return perm ? roleHasPermission(role, perm) : true;
}

export async function renderAdminMenu(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId)) {
    // Non-admins should not even know this exists
    return;
  }

  const text = '⚙️ <b>Bighabesha Shop — Admin Control Panel</b>\n\n' +
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
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function renderAdminProducts(ctx: Context): Promise<void> {
  if (!isAdmin(ctx.from?.id)) return;

  const products = getAllProducts(true);
  const keyboard = new InlineKeyboard();

  let text = '📦 <b>Manage Products & Prices</b>\n\n' +
    'Tap any variant below to modify its price in ETB:\n\n';

  for (const prod of products) {
    const statusIcon = prod.is_active ? '🟢 Active' : '🔴 Disabled';
    text += `<b>${escapeHtml(prod.name)}</b> [${statusIcon}]\n`;

    const variants = getProductVariants(prod.id, true);
    for (const v of variants) {
      text += `  • ${escapeHtml(v.name)}: ${formatPriceETB(v.price_etb)}\n`;
      keyboard.text(`✏️ ${prod.name.split(' ')[0]} - ${v.name} (${v.price_etb} ETB)`, `admin_edit_var_${v.id}`).row();
    }
    text += '\n';
  }

  keyboard.text('« Back to Admin Menu', 'admin_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
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

  const text = `✏️ <b>Edit Price for "${escapeHtml(variant.name)}"</b>\n\n` +
    `Current Price: <b>${formatPriceETB(variant.price_etb)}</b>\n\n` +
    `💬 <i>Please send the new price in ETB as an integer (e.g. <code>1600</code>):</i>`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', 'admin_products');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function renderAdminStock(ctx: Context): Promise<void> {
  if (!isAdmin(ctx.from?.id)) return;

  const geminiStock = getTotalStockCount('gemini_pro_18m');
  const threshold = getNumericSetting('low_stock_threshold', 5);

  const text = '🔑 <b>Stock Inventory Management</b>\n\n' +
    '🤖 <b>Gemini Pro (18 Months)</b>\n' +
    `• Available Unused Links: <b>${geminiStock.available}</b>\n` +
    `• Delivered Orders: <b>${geminiStock.allocated}</b>\n` +
    `• Total Uploaded: <b>${geminiStock.total}</b>\n` +
    `• Low-Stock Alert Threshold: <b>${threshold}</b>\n\n` +
    'Choose an action below to restock:';

  const keyboard = new InlineKeyboard()
    .text('➕ Paste Activation Links', 'admin_stock_paste_gemini_pro_18m')
    .row()
    .text('📄 Upload CSV File', 'admin_stock_csv_gemini_pro_18m')
    .row()
    .text('« Back to Admin Menu', 'admin_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function promptStockPaste(ctx: Context, productId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId) || !userId) return;

  setPendingAction(userId, {
    type: 'admin_stock_single_paste',
    data: { productId },
  });

  const text = `➕ <b>Paste Activation Links</b>\n\n` +
    `Send one or multiple activation links in chat.\n\n` +
    `<i>You can paste multiple links on separate lines. Each line will be added as a separate available stock item.</i>`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', 'admin_stock');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function promptStockCSV(ctx: Context, productId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId) || !userId) return;

  setPendingAction(userId, {
    type: 'admin_stock_csv_paste',
    data: { productId },
  });

  const text = `📄 <b>Upload Stock CSV File</b>\n\n` +
    `Please upload a <code>.csv</code> or <code>.txt</code> document containing activation links, or paste the raw CSV content directly into the chat.\n\n` +
    `<i>Format: one link per row or CSV with a <code>link</code> column header.</i>`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', 'admin_stock');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function renderAdminRates(ctx: Context): Promise<void> {
  if (!isAdmin(ctx.from?.id)) return;

  const etbPerUsd = getNumericSetting('etb_per_usd', 135);
  const etbPerStar = getNumericSetting('etb_per_star', 2.5);
  const marginPct = getNumericSetting('margin_pct', 5);
  const starsMin = getNumericSetting('stars_min', 10);
  const starsMax = getNumericSetting('stars_max', 100000);

  const text = '📈 <b>Exchange Rates & Pricing Parameters</b>\n\n' +
    `• <b>ETB per USD:</b> ${etbPerUsd} ETB\n` +
    `• <b>ETB per Star:</b> ${etbPerStar} ETB\n` +
    `• <b>Crypto Margin:</b> ${marginPct}%\n` +
    `• <b>Min Custom Stars:</b> ${starsMin.toLocaleString()} ⭐\n` +
    `• <b>Max Custom Stars:</b> ${starsMax.toLocaleString()} ⭐\n\n` +
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
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function renderAdminSettings(ctx: Context): Promise<void> {
  if (!isAdmin(ctx.from?.id)) return;

  const cbeAccount = getSetting('cbe_account', '0000000000000');
  const telebirrAccount = getSetting('telebirr_account', '0000000000');
  const abyssiniaAccount = getSetting('abyssinia_account', '0000000000000');
  const lowStock = getNumericSetting('low_stock_threshold', 5);

  const text = '🏦 <b>Bank Accounts & General Settings</b>\n\n' +
    `• <b>CBE Account:</b> <code>${escapeHtml(cbeAccount)}</code>\n` +
    `• <b>Telebirr:</b> <code>${escapeHtml(telebirrAccount)}</code>\n` +
    `• <b>Bank of Abyssinia:</b> <code>${escapeHtml(abyssiniaAccount)}</code>\n` +
    `• <b>Low-Stock Alert Threshold:</b> ${lowStock}\n\n` +
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
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
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

  const text = `✏️ <b>Edit Setting: <code>${escapeHtml(settingKey)}</code></b>\n\n` +
    `Current Value: <b>${escapeHtml(currentVal)}</b>\n\n` +
    `💬 <i>Please send the new value in chat:</i>`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', 'admin_settings');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

