import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
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
import { adminRouter, setAdminBotInstance } from './admin.js';

export function createExpressApp(bot: Bot): express.Express {
  const app = express();
  const config = getConfig();

  // Bind bot instance to admin routes for sending Telegram 2FA codes and buyer notifications
  setAdminBotInstance(bot);

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Helper: Authenticate Telegram initData
  const authenticateTelegramUser = (req: Request): TelegramUser | null => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return null;

    const rawInitData = authHeader.replace(/^tma\s+/i, '').replace(/^bearer\s+/i, '');
    const validated = validateTelegramInitData(rawInitData, config.BOT_TOKEN);
    return validated ? validated.user : null;
  };

  // 1. Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 2. Mini App Bootstrap data
  app.get('/api/bootstrap', async (req: Request, res: Response) => {
    try {
      const user = authenticateTelegramUser(req);
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

      res.json({
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
    } catch (err: any) {
      logger.error({ err }, 'Error in /api/bootstrap');
      res.status(500).json({ error: 'Failed to load bootstrap data' });
    }
  });

  // 3. User Orders list (Authenticated with Telegram initData)
  app.get('/api/orders', (req: Request, res: Response): void => {
    const user = authenticateTelegramUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const orders = getOrdersByUserId(user.id, 50);
    res.json({ orders });
  });

  // 4. Single Order Detail
  app.get('/api/orders/:id', (req: Request, res: Response): void => {
    const user = authenticateTelegramUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const orderId = req.params.id as string;
    const order = getOrderById(orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    if (order.user_id !== user.id && !config.ADMIN_IDS.includes(user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json({ order });
  });

  // 5. Create Order
  app.post('/api/orders', async (req: Request, res: Response): Promise<void> => {
    const user = authenticateTelegramUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { productId, variantId, customStars, amountETB, paymentRail } = req.body;

    if (!productId || !amountETB || !paymentRail) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Username Gate check
    if (isUsernameRequired(productId) && !hasPublicUsername(user)) {
      res.status(403).json({
        error: 'USERNAME_REQUIRED',
        message: 'Telegram public @username is required to purchase Telegram Premium or Stars.',
      });
      return;
    }

    const product = getProductById(productId);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
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
        invoiceLink = await bot.api.createInvoiceLink(
          `Bighabesha: ${product.name}`,
          `Order #${order.id}`,
          `order_${order.id}`,
          '',
          'XTR',
          [{ label: product.name, amount: starsDue }]
        );
      } catch (err: any) {
        logger.warn({ err: err.message, orderId: order.id }, 'Failed to generate stars invoice link');
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

    res.status(201).json({ order, invoiceLink, payUrl });
  });

  // 6. Submit Receipt
  app.post('/api/receipt', async (req: Request, res: Response): Promise<void> => {
    const user = authenticateTelegramUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { orderId, receiptImageBase64, note } = req.body;
    if (!orderId) {
      res.status(400).json({ error: 'orderId is required' });
      return;
    }

    const order = getOrderById(orderId);
    if (!order || order.user_id !== user.id) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const fileId = receiptImageBase64 ? `base64_upload_${Date.now()}` : 'web_receipt_upload';
    const updated = submitReceipt(orderId, fileId, note);

    try {
      const alertContext: any = {
        api: bot.api,
      };
      await notifyAdminsNewReceipt(alertContext, updated);
    } catch (err) {
      logger.warn({ err }, 'Failed to notify admin of new receipt');
    }

    res.json({ order: updated, success: true });
  });

  // 7. Mount Web Admin Dashboard API Routes
  app.use('/api/admin', adminRouter);

  return app;
}

export function createApiServer(bot: Bot): http.Server {
  const app = createExpressApp(bot);
  return http.createServer(app);
}

export function startApiServer(bot: Bot, port: number = 3000): http.Server {
  const server = createApiServer(bot);
  server.listen(port, () => {
    logger.info({ port }, `Mini App REST API listening on http://localhost:${port}`);
  });
  return server;
}
