import http from 'http';
import { URL } from 'url';
import { Bot } from 'grammy';
import { validateTelegramInitData, TelegramUser } from './auth.js';
import { getAllProducts, getProductById, getProductVariants, getVariantById } from '../services/catalog.service.js';
import { getAvailableStockCount } from '../services/stock.service.js';
import { getAllSettings, getNumericSetting } from '../services/settings.service.js';
import { fetchCoinGeckoPrices, calculateStarsDue, calculateCryptoQuote } from '../services/rate_engine.service.js';
import { createOrder, getOrdersByUserId, getOrderById, submitReceipt, Order } from '../services/orders.service.js';
import { getWalletPayAdapter } from '../services/payments/index.js';
import { isUsernameRequired, hasPublicUsername } from '../bot/handlers/gate.js';
import { notifyAdminsNewReceipt } from '../bot/handlers/checkout.js';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/index.js';

export function createApiServer(bot: Bot): http.Server {
  const config = getConfig();

  const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = reqUrl.pathname;

    const sendJson = (statusCode: number, data: any) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const parseBody = async (): Promise<any> => {
      return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (e) {
            reject(e);
          }
        });
        req.on('error', reject);
      });
    };

    // Helper: Authenticate Telegram initData
    const authenticate = (): TelegramUser | null => {
      const authHeader = req.headers['authorization'];
      if (!authHeader) return null;

      const rawInitData = authHeader.replace(/^tma\s+/i, '').replace(/^bearer\s+/i, '');
      const validated = validateTelegramInitData(rawInitData, config.BOT_TOKEN);
      return validated ? validated.user : null;
    };

    try {
      // 1. Health check
      if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(200, { status: 'ok', timestamp: new Date().toISOString() });
        return;
      }

      // 2. Bootstrap data
      if (pathname === '/api/bootstrap' && req.method === 'GET') {
        const user = authenticate();
        const products = getAllProducts();
        const catalogWithDetails = products.map((prod) => {
          const variants = getProductVariants(prod.id);
          const stock = prod.type === 'stock' ? getAvailableStockCount(prod.id) : null;
          return {
            ...prod,
            variants,
            availableStock: stock,
          };
        });

        const settings = getAllSettings();
        const cryptoRates = await fetchCoinGeckoPrices();

        sendJson(200, {
          user: user
            ? {
                id: user.id,
                username: user.username,
                firstName: user.first_name,
                languageCode: user.language_code || 'en',
                isAdmin: config.ADMIN_IDS.includes(user.id),
              }
            : null,
          products: catalogWithDetails,
          settings,
          cryptoRates,
        });
        return;
      }

      // Authentication required for subsequent endpoints
      const user = authenticate();
      if (!user) {
        sendJson(401, { error: 'Unauthorized: Invalid or missing Telegram initData' });
        return;
      }

      // 3. User Orders list
      if (pathname === '/api/orders' && req.method === 'GET') {
        const orders = getOrdersByUserId(user.id, 50);
        sendJson(200, { orders });
        return;
      }

      // 4. Single Order Detail
      if (pathname.startsWith('/api/orders/') && req.method === 'GET') {
        const orderId = pathname.replace('/api/orders/', '');
        const order = getOrderById(orderId);
        if (!order) {
          sendJson(404, { error: 'Order not found' });
          return;
        }

        // Must be owner or admin
        if (order.user_id !== user.id && !config.ADMIN_IDS.includes(user.id)) {
          sendJson(403, { error: 'Access denied' });
          return;
        }

        sendJson(200, { order });
        return;
      }

      // 5. Create Order
      if (pathname === '/api/orders' && req.method === 'POST') {
        const body = await parseBody();
        const { productId, variantId, customStars, amountETB, paymentRail } = body;

        if (!productId || !amountETB || !paymentRail) {
          sendJson(400, { error: 'Missing required parameters (productId, amountETB, paymentRail)' });
          return;
        }

        // Username Gate check
        if (isUsernameRequired(productId) && !hasPublicUsername(user)) {
          sendJson(403, {
            error: 'USERNAME_REQUIRED',
            message: 'Telegram public @username is required to purchase Telegram Premium or Stars.',
          });
          return;
        }

        const product = getProductById(productId);
        if (!product) {
          sendJson(404, { error: 'Product not found' });
          return;
        }

        const order = createOrder({
          userId: user.id,
          username: user.username || null,
          productId,
          variantId: variantId || null,
          quantity: customStars || 1,
          amountETB,
          paymentRail,
          status: 'awaiting_payment',
        });

        let invoiceLink: string | undefined;
        let payUrl: string | undefined;

        if (paymentRail === 'stars') {
          const starsDue = calculateStarsDue(order.amount_etb);
          try {
            // Generate Telegram Bot Payments invoice link
            invoiceLink = await bot.api.createInvoiceLink(
              `Bighabesha: ${product.name}`,
              `Order #${order.id}`,
              `order_${order.id}`,
              '', // Provider token empty for XTR
              'XTR',
              [{ label: product.name, amount: starsDue }]
            );
          } catch (err: any) {
            logger.warn({ err: err.message, orderId: order.id }, 'Failed to generate stars invoice link via Bot API');
          }
        } else if (paymentRail === 'wallet_pay') {
          const adapter = getWalletPayAdapter();
          const payment = await adapter.createPayment({
            orderId: order.id,
            userId: user.id,
            amountETB: order.amount_etb,
            productName: product.name,
            currency: 'TON',
          });
          payUrl = payment.payUrl;
        }

        sendJson(201, { order, invoiceLink, payUrl });
        return;
      }

      // 6. Submit Receipt
      if (pathname === '/api/receipt' && req.method === 'POST') {
        const body = await parseBody();
        const { orderId, receiptImageBase64, note } = body;

        if (!orderId) {
          sendJson(400, { error: 'orderId is required' });
          return;
        }

        const order = getOrderById(orderId);
        if (!order || order.user_id !== user.id) {
          sendJson(404, { error: 'Order not found' });
          return;
        }

        const fileId = receiptImageBase64 ? `base64_upload_${Date.now()}` : 'web_receipt_upload';
        const updated = submitReceipt(orderId, fileId, note);

        // Send alert to admin via Bot API
        try {
          const alertContext: any = {
            api: bot.api,
          };
          await notifyAdminsNewReceipt(alertContext, updated);
        } catch (err) {
          logger.warn({ err }, 'Failed to send admin notification for web receipt');
        }

        sendJson(200, { order: updated, success: true });
        return;
      }

      // 404 for unknown endpoints
      sendJson(404, { error: 'Endpoint not found' });
    } catch (err: any) {
      logger.error({ err: err.message, pathname }, 'API server error');
      sendJson(500, { error: 'Internal Server Error', message: err.message });
    }
  });

  return server;
}

export function startApiServer(bot: Bot, port: number = 3000): http.Server {
  const server = createApiServer(bot);
  server.listen(port, () => {
    logger.info({ port }, `Mini App REST API listening on http://localhost:${port}`);
  });
  return server;
}
