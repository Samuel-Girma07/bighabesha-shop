import { Api, InlineKeyboard, RawApi } from 'grammy';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/index.js';
import { getProductById } from './catalog.service.js';

export async function sendLowStockAlert(
  api: Api<RawApi>,
  productId: string,
  remainingCount: number
): Promise<void> {
  const config = getConfig();
  const product = getProductById(productId);
  const productName = product ? product.name : productId;

  const isSoldOut = remainingCount === 0;
  const statusEmoji = isSoldOut ? '🚨' : '⚠️';
  const alertTitle = isSoldOut ? 'PRODUCT SOLD OUT' : 'LOW STOCK ALERT';

  const message = `${statusEmoji} *${alertTitle}*\n\n` +
    `📦 *Product:* ${productName}\n` +
    `🔢 *Available Stock:* ${remainingCount} left\n\n` +
    `Please restock activation links soon to avoid fulfillment delays.`;

  const keyboard = new InlineKeyboard()
    .text('➕ Add Stock Links', `admin_stock_add_${productId}`)
    .row()
    .text('⚙️ Manage Product', `admin_prod_${productId}`);

  for (const adminId of config.ADMIN_IDS) {
    try {
      await api.sendMessage(adminId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      logger.info({ adminId, productId, remainingCount }, 'Low stock alert sent to admin');
    } catch (err) {
      logger.error({ err, adminId, productId }, 'Failed to send low stock alert to admin');
    }
  }
}
