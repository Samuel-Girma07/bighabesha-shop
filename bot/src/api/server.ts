import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { Bot } from 'grammy';
import { validateTelegramInitData, TelegramUser } from './auth.js';
import { getAllProducts, getProductVariants, getProductById } from '../services/catalog.service.js';

/** Non-throwing product lookup for pre-flight checks (DB may be mid-migration). */
function getProductByIdSafe(productId: string) {
  try {
    return getProductById(productId);
  } catch {
    return undefined;
  }
}
import { getAvailableStockCount } from '../services/stock.service.js';
import { getPublicSettings, getNumericSetting, getSetting } from '../services/settings.service.js';
import { fetchCoinGeckoPrices, calculateStarsDue } from '../services/rate_engine.service.js';
import { createOrder, getOrdersByUserId, getOrderById, getOrderEvents, submitReceipt, approveReceipt, updateOrderStatus, Order, PaymentRail } from '../services/orders.service.js';
import { resolveOrderPrice, PricingError } from '../services/pricing.service.js';
import { saveReceiptImage, ReceiptValidationError, resolveReceiptsDir } from '../services/receipts.service.js';
import { getWalletPayAdapter, verifyWalletPayWebhookSignature, isWebhookTimestampFresh, startWalletPayReconciliation } from '../services/payments/index.js';
import { verifyChapaSignature, chapaInitialize, isChapaEnabled } from '../services/payments/chapa.js';
import { verifyTonPayment, isTonConnectEnabled } from '../services/payments/ton.service.js';
import { calculateCryptoQuote } from '../services/rate_engine.service.js';
import { recordAudit } from '../services/audit.service.js';
import { getUserStats } from '../services/loyalty.service.js';
import { getReferralSummary } from '../services/referral.service.js';
import {
  getOrCreateThread,
  insertSupportMessage,
  getThreadMessages,
  isSupportBridgeEnabled,
  SUPPORT_MAX_MESSAGE_LENGTH,
} from '../services/support.service.js';
import { escapeHtml } from '../utils/html.js';
import { notifyBuyerOfAutoApproval as notifyBuyerOfAutoApprovalService } from '../services/buyer_notify.js';
import { isUsernameRequired, hasPublicUsername } from '../bot/handlers/gate.js';
import { notifyAdminsNewReceipt } from '../bot/handlers/checkout.js';
import { getDatabase } from '../db/index.js';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/index.js';
import { adminRouter, setAdminBotInstance } from './admin.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GENERAL_BODY_LIMIT = '100kb';
const RECEIPT_BODY_LIMIT = '3mb';

function captureRawBody(req: any, _res: Response, buf: Buffer): void {
  req.rawBody = buf.toString('utf-8');
}

/** Converts an ETB payable into the TON quote used for on-chain matching. */
async function quoteEtbToTon(netAmountEtb: number): Promise<number> {
  const { tonUsd } = await fetchCoinGeckoPrices();
  const { cryptoAmount } = calculateCryptoQuote(netAmountEtb, tonUsd);
  return cryptoAmount;
}

/**
 * Shared post-approval buyer notification for auto-settled rails
 * (wallet pay webhook, Chapa webhook, TON verification) — implementation
 * lives in services/buyer_notify.ts so the background reconciliation worker
 * reuses the exact same delivery texts.
 */
const notifyBuyerOfAutoApproval = notifyBuyerOfAutoApprovalService;

/** Express middleware factory: attaches validated Telegram user or 401s. */
function authenticateTelegramUserMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const config = getConfig();
    const authHeader = req.headers.authorization as string | undefined;
    const rawInitData = authHeader ? authHeader.replace(/^tma\s+/i, '').replace(/^bearer\s+/i, '') : '';
    const validated = validateTelegramInitData(rawInitData, config.BOT_TOKEN);
    if (!validated) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    (req as any).tgUser = validated.user;
    next();
  };
}

function handleReceiptUpload(bot: Bot) {
  return async (req: Request, res: Response): Promise<void> => {
    const config = getConfig();
    const authHeader = req.headers['authorization'];
    const rawInitData = authHeader
      ? authHeader.replace(/^tma\s+/i, '').replace(/^bearer\s+/i, '')
      : '';
    const validated = validateTelegramInitData(rawInitData, config.BOT_TOKEN);
    if (!validated) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const user = validated.user;

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

    let fileId = 'web_receipt_upload';
    if (receiptImageBase64) {
      try {
        // Persisted reference is filename-only; resolution happens through
        // resolveStoredReceiptPath() at read time (traversal-safe).
        const saved = saveReceiptImage(receiptImageBase64, orderId);
        fileId = saved.storedName;
      } catch (saveErr) {
        if (saveErr instanceof ReceiptValidationError) {
          res.status(400).json({ error: saveErr.message });
          return;
        }
        logger.error({ err: saveErr, orderId }, 'Failed to save receipt image to disk, using memory fallback');
        fileId = `base64_upload_${Date.now()}`;
      }
    }

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
  };
}

/**
 * Configures express `trust proxy` from the TRUST_PROXY env setting.
 * Required behind cloudflared/reverse proxies so rate limits key on real
 * client IPs instead of the proxy's loopback address.
 */
export function resolveTrustProxySetting(raw: string): boolean | number | string | undefined {
  const value = raw.trim();
  if (!value || value === 'false' || value === '0') return undefined;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (value === 'true') return true;
  return value;
}

function buildCorsOptions(config: ReturnType<typeof getConfig>) {
  const allowedOrigins = new Set<string>();
  if (config.WEBAPP_URL) {
    allowedOrigins.add(config.WEBAPP_URL.replace(/\/+$/, ''));
  }
  for (const origin of config.CORS_ORIGINS.split(',')) {
    const trimmed = origin.trim().replace(/\/+$/, '');
    if (trimmed) allowedOrigins.add(trimmed);
  }

  return {
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      // Requests without an Origin header are non-browser clients
      // (curl, server-to-server, same-origin) — no CORS decision needed.
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  };
}

export function createExpressApp(bot: Bot): express.Express {
  const app = express();
  const config = getConfig();

  // Bind bot instance to admin routes for sending Telegram 2FA codes and buyer notifications
  setAdminBotInstance(bot);

  const trustProxy = resolveTrustProxySetting(config.TRUST_PROXY);
  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://telegram.org'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          // TON Connect renders third-party wallet logos from many domains.
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: [
            "'self'",
            'https://telegram.org',
            'https://api.coingecko.com',
            'https://toncenter.com',
            'https://config.ton.org',
            'https://bridge.tonconnect.org',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          frameSrc: ["'self'", 'https://telegram.org'],
          // Telegram Mini Apps render inside telegram.org web/desktop iframes.
          frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org', 'https://telegram.org'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // All traffic terminates on HTTPS at Cloudflare; HSTS pins browsers to
      // it even if a user types the bare hostname.
      hsts: { maxAge: 180 * 24 * 60 * 60, includeSubDomains: true },
    })
  );

  // ---- Rate limiters (instantiated per-app so test servers get fresh buckets) --
  const jsonRateLimitHandler = (message: string) => (_req: Request, res: Response) => {
    res.status(429).json({ error: message });
  };

  const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: jsonRateLimitHandler('Too many login attempts. Please try again in 15 minutes.'),
  });

  const adminOtpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: jsonRateLimitHandler('Too many verification attempts. Please request a new code.'),
  });

  const checkoutLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: jsonRateLimitHandler('Too many requests. Please slow down.'),
  });

  const receiptLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: jsonRateLimitHandler('Too many receipt uploads. Please slow down.'),
  });

  const globalApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.path === '/api/health' ||
      req.path.startsWith('/api/admin') ||
      !req.path.startsWith('/api'),
    handler: jsonRateLimitHandler('Too many requests from this address. Please try again later.'),
  });

  // Receipt uploads carry a base64 image and need a larger body cap than the
  // global JSON limit, so this route mounts its own parser BEFORE the
  // restrictive global one below.
  app.post(
    '/api/receipt',
    cors(buildCorsOptions(config)),
    express.json({ limit: RECEIPT_BODY_LIMIT, verify: captureRawBody }),
    receiptLimiter,
    handleReceiptUpload(bot)
  );

  app.use(cors(buildCorsOptions(config)));
  app.use(express.json({ limit: GENERAL_BODY_LIMIT, verify: captureRawBody }));
  app.use(globalApiLimiter);

  // Static Assets Serving from compiled webapp dist
  const distPaths = [
    path.resolve(__dirname, '../../../webapp/dist'),
    path.resolve(__dirname, '../../webapp/dist'),
    path.resolve(process.cwd(), 'webapp/dist'),
    path.resolve(process.cwd(), '../webapp/dist'),
  ];
  const distDir = distPaths.find((p) => fs.existsSync(p));

  if (distDir) {
    logger.info({ distDir }, 'Serving static Web App & Admin Dashboard assets');
    app.use(express.static(distDir));
  }

  // Helper: Authenticate Telegram initData
  const authenticateTelegramUser = (req: Request): TelegramUser | null => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return null;

    const rawInitData = authHeader.replace(/^tma\s+/i, '').replace(/^bearer\s+/i, '');
    const validated = validateTelegramInitData(rawInitData, config.BOT_TOKEN);
    return validated ? validated.user : null;
  };

  // 1. Health check — verifies the SQLite database is readable AND writable.
  // Returns 503 when the database is disconnected or corrupted so process
  // supervisors and uptime monitors can detect real outages.
  //
  // The write probe is throttled to at most one write per 10s so aggressive
  // external monitors (1s polling) don't generate constant WAL churn.
  let lastHeartbeatWriteMs = 0;
  app.get('/api/health', (_req: Request, res: Response) => {
    const checks: Record<string, unknown> = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };

    try {
      const db = getDatabase();

      // Read probe — always runs (cheap, proves the DB is queryable).
      db.prepare('SELECT COUNT(*) as c FROM settings').get();
      checks.databaseRead = 'ok';

      // Write probe — throttled; a recent successful write is still proof
      // the database accepts writes.
      const now = Date.now();
      if (now - lastHeartbeatWriteMs >= 10_000) {
        db.exec('CREATE TABLE IF NOT EXISTS _health_heartbeat (id INTEGER PRIMARY KEY CHECK (id = 1), ts TEXT NOT NULL)');
        db.prepare(
          `INSERT INTO _health_heartbeat (id, ts) VALUES (1, ?)
           ON CONFLICT(id) DO UPDATE SET ts = excluded.ts`
        ).run(new Date().toISOString());
        lastHeartbeatWriteMs = now;
        checks.databaseWrite = 'ok';
      } else {
        checks.databaseWrite = 'ok (throttled)';
      }
      // NOTE: no filesystem paths echoed here — this endpoint is unauthenticated.

      res.status(200).json(checks);
    } catch (err: any) {
      logger.error({ err }, 'Health check FAILED — database unavailable');
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'unavailable',
        error: 'Database read/write probe failed',
      });
    }
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

      // Only expose the whitelisted, client-facing settings — operational
      // parameters (margins, FX rates, stock thresholds, delivery
      // instructions) must never leak to unauthenticated clients.
      const settings = getPublicSettings();
      const cryptoRates = await fetchCoinGeckoPrices();

      const userStats = user ? getUserStats(user.id) : null;

      res.json({
        user: user
          ? {
              id: user.id,
              username: user.username,
              firstName: user.first_name,
              languageCode: user.language_code || 'en',
              isAdmin: config.ADMIN_IDS.includes(user.id),
              tier: userStats?.tier ?? 'bronze',
              ordersCount: userStats?.orders_count ?? 0,
              lifetimeEtb: userStats?.lifetime_etb ?? 0,
              balanceStars: Math.floor((userStats?.lifetime_etb ?? 0) / 10),
            }
          : null,
        products: catalogWithDetails,
        settings,
        cryptoRates,
        tonTreasury: config.TON_TREASURY_ADDRESS || undefined,
      });
    } catch (err: any) {
      logger.error({ err }, 'Error in /api/bootstrap');
      res.status(500).json({ error: 'Failed to load bootstrap data' });
    }
  });

  // 2b. User Live Username Recheck (fetches live username directly from Telegram Bot API)
  app.get('/api/user/recheck-username', async (req: Request, res: Response): Promise<void> => {
    const user = authenticateTelegramUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let currentUsername = user.username || null;

    try {
      const chat = await bot.api.getChat(user.id);
      if ('username' in chat && chat.username) {
        currentUsername = chat.username;
      }
    } catch (err) {
      logger.warn({ err, userId: user.id }, 'Could not fetch live chat info in /api/user/recheck-username');
    }

    if (currentUsername) {
      try {
        const db = getDatabase();
        db.prepare(`
          INSERT INTO users (id, username, first_name)
          VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            username = excluded.username,
            updated_at = CURRENT_TIMESTAMP
        `).run(user.id, currentUsername, user.first_name || 'Buyer');
      } catch (err) {
        logger.error({ err, userId: user.id }, 'Failed to update username in DB during recheck-username');
      }
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: currentUsername,
        firstName: user.first_name,
        languageCode: user.language_code || 'en',
        isAdmin: config.ADMIN_IDS.includes(user.id),
      },
    });
  });

  // 2c. In-app support bridge (Mini App live chat ↔ admin forum topics)
  const supportLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? 'unknown')}:${(req.headers.authorization || '').slice(-24)}`,
    handler: (_req, res) => res.status(429).json({ error: 'Too many messages. Please slow down.' }),
  });

  app.post('/api/support/messages', authenticateTelegramUserMiddleware(), supportLimiter, async (req: Request, res: Response): Promise<void> => {
    if (!isSupportBridgeEnabled()) {
      res.status(503).json({ error: 'Support chat is currently unavailable. Please use the Support button in the bot.' });
      return;
    }
    const user = (req as any).tgUser as TelegramUser;
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body || body.length > SUPPORT_MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `Message must be 1-${SUPPORT_MAX_MESSAGE_LENGTH} characters.` });
      return;
    }

    try {
      const thread = await getOrCreateThread(bot.api, user.id, user.username ?? null, user.first_name);
      insertSupportMessage(thread.id, 'user', body);

      // Relay into the admin forum topic.
      if (thread.forum_topic_id) {
        const header = `👤 <b>${escapeHtml(user.first_name)}</b> @${escapeHtml(user.username ?? 'nouser')} <code>#${user.id}</code>`;
        await bot.api.sendMessage(config.SUPPORT_GROUP_ID!, `${header}\n\n${escapeHtml(body)}`, {
          parse_mode: 'HTML',
          message_thread_id: thread.forum_topic_id,
        }).then((m: any) => {
          if (m?.message_id) {
            getDatabase().prepare('UPDATE support_messages SET tg_message_id = ? WHERE thread_id = ? AND sender_role = ? AND id = (SELECT MAX(id) FROM support_messages WHERE thread_id = ?)')
              .run(m.message_id, thread.id, 'user', thread.id);
          }
        }).catch((err: any) => logger.error({ err }, 'Failed relaying support message to topic'));
      }

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Support unavailable' });
    }
  });

  app.get('/api/support/messages', authenticateTelegramUserMiddleware(), (req: Request, res: Response): void => {
    const user = (req as any).tgUser as TelegramUser;
    const db = getDatabase();
    const thread = db.prepare(
      "SELECT * FROM support_threads WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1"
    ).get(user.id) as any;

    if (!thread) {
      res.json({ messages: [], status: 'none' });
      return;
    }
    const after = parseInt(String(req.query.after ?? '0'), 10) || 0;
    res.json({ status: thread.status, messages: getThreadMessages(thread.id, after) });
  });

  // 2d. Referral program summary for the authenticated buyer
  app.get('/api/me/referrals', authenticateTelegramUserMiddleware(), (req: Request, res: Response): void => {
    const user = (req as any).tgUser as TelegramUser;
    const summary = getReferralSummary(user.id);
    res.json(summary);
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

    // Timeline events power the Mini App progress stepper.
    res.json({ order, events: getOrderEvents(order.id) });
  });

  // 5. Create Order
  const VALID_PAYMENT_RAILS: PaymentRail[] = ['stars', 'wallet_pay', 'telebirr', 'cbe', 'abyssinia'];

  app.post('/api/orders', checkoutLimiter, async (req: Request, res: Response): Promise<void> => {
    const user = authenticateTelegramUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // NOTE: `amountETB` from the request body is deliberately ignored — the
    // price is always resolved server-side from the catalog and rate engine.
    const { productId, variantId, customStars, paymentRail } = req.body;

    if (!productId || !paymentRail) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    if (!VALID_PAYMENT_RAILS.includes(paymentRail)) {
      res.status(400).json({ error: 'Invalid payment method' });
      return;
    }

    if (customStars !== undefined && customStars !== null && (!Number.isInteger(customStars) || customStars <= 0)) {
      res.status(400).json({ error: 'Custom Stars amount must be a positive whole number' });
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

    // Stock gate: never create orders or generate Stars invoices for stock
    // products that cannot be fulfilled. (Mirrors the bot's product page.)
    const stockProduct = getProductByIdSafe(productId);
    if (stockProduct && stockProduct.type === 'stock') {
      const available = getAvailableStockCount(productId);
      if (available <= 0) {
        res.status(409).json({ error: 'OUT_OF_STOCK', message: 'This product is currently sold out.' });
        return;
      }
    }

    let resolved;
    try {
      const stats = getUserStats(user.id);
      resolved = resolveOrderPrice({
        productId,
        variantId: variantId || null,
        customStars: customStars || null,
        userTier: stats?.tier ?? null,
      });
    } catch (err) {
      if (err instanceof PricingError) {
        logger.warn({ err, userId: user.id, productId, variantId }, 'Order creation blocked by pricing validation');
        res.status(400).json({ error: err.message });
      } else {
        logger.error({ err, productId }, 'Unexpected error while resolving order price');
        res.status(500).json({ error: 'Failed to resolve order pricing' });
      }
      return;
    }

    // Promo codes are redeemed atomically inside createOrder's transaction —
    // an invalid code aborts the whole creation.
    const promoCode = typeof req.body.promoCode === 'string' && req.body.promoCode.trim()
      ? req.body.promoCode.trim().toUpperCase()
      : null;

    let created;
    try {
      created = createOrder({
        userId: user.id,
        username: user.username || null,
        productId,
        variantId: variantId || null,
        quantity: resolved.quantity,
        amountETB: resolved.amountETB,
        paymentRail,
        status: 'awaiting_payment',
        promoCode,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Could not apply promo code' });
      return;
    }
    const order = created;

    const netAmountEtb = Math.max(order.amount_etb - (order.discount_etb || 0), 1);

    let invoiceLink: string | undefined;
    let payUrl: string | undefined;

    if (paymentRail === 'stars') {
      const starsDue = calculateStarsDue(netAmountEtb);
      try {
        invoiceLink = await bot.api.createInvoiceLink(
          `Bighabesha: ${resolved.product.name}`,
          `Order #${order.id}`,
          `order_${order.id}`,
          '',
          'XTR',
          [{ label: resolved.product.name, amount: starsDue }]
        );
      } catch (err: any) {
        logger.warn({ err: err.message, orderId: order.id }, 'Failed to generate stars invoice link');
      }
    } else if (paymentRail === 'wallet_pay') {
      const adapter = getWalletPayAdapter();
      const payment = await adapter.createPayment({
        orderId: order.id,
        userId: user.id,
        amountETB: netAmountEtb,
        productName: resolved.product.name,
        currency: 'TON',
      });
      payUrl = payment.payUrl;

      // Persist the provider payment reference and the quoted crypto amount
      // immediately — the reconciliation worker and webhook validator both
      // depend on these being stored at creation time.
      updateOrderStatus(order.id, order.status, {
        payment_ref: payment.paymentRef || null,
        crypto_amount: payment.cryptoAmount ?? null,
        crypto_currency: payment.cryptoCurrency ?? null,
      });
    } else if (paymentRail === 'chapa') {
      if (!isChapaEnabled()) {
        res.status(400).json({ error: 'Chapa payments are not available.' });
        return;
      }
      try {
        const init = await chapaInitialize({
          txRef: order.id,
          amountEtb: netAmountEtb,
          buyerName: user.first_name,
          buyerPhone: null,
          returnUrl: `${config.WEBAPP_URL || ''}/orders`,
        });
        payUrl = init.payUrl;
        updateOrderStatus(order.id, order.status, { payment_ref: init.providerRef });
      } catch (err: any) {
        logger.error({ err, orderId: order.id }, 'Chapa initialization failed');
        res.status(502).json({ error: 'Payment provider unavailable. Please try another method.' });
        return;
      }
    }

    res.status(201).json({ order, invoiceLink, payUrl, saleApplied: resolved.saleApplied === true });
  });

  // 5b. Chapa webhook — HMAC-SHA256(rawBody) via 'chapa-signature' header.
  app.post('/api/webhooks/chapa', async (req: Request, res: Response): Promise<void> => {
    const config = getConfig();
    const secretKey = config.CHAPA_SECRET_KEY;
    if (!secretKey) {
      res.status(503).json({ error: 'Chapa not configured' });
      return;
    }

    const signature = req.headers['chapa-signature'] as string | undefined;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    if (!verifyChapaSignature(secretKey, signature, rawBody)) {
      logger.warn('Rejected Chapa webhook with invalid signature');
      res.status(403).json({ error: 'Invalid signature' });
      return;
    }

    try {
      const event = req.body as { event?: string; tx_ref?: string; status?: string; amount?: number | string };
      const txRef = String(event.tx_ref || '');
      const order = txRef ? getOrderById(txRef) : undefined;
      if (!order) {
        res.status(200).json({ status: 'ignored', reason: 'unknown_order' });
        return;
      }

      // Idempotency: only actionable states may transition.
      const actionable = ['awaiting_payment', 'new', 'pending_approval'].includes(order.status);
      const paid = event.status === 'success' || event.event === 'CHARGE.SUCCESS';
      if (!actionable || !paid) {
        res.status(200).json({ status: 'ignored', reason: 'not_actionable' });
        return;
      }

      // Amount verification against net payable (never trust the payload blindly).
      const expected = order.amount_etb - (order.discount_etb || 0);
      const paidAmount = Number(event.amount);
      if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - expected) > 0.99) {
        logger.warn({ orderId: order.id, expected, received: paidAmount }, 'Chapa webhook amount mismatch — NOT fulfilling');
        recordAudit({ adminId: 'system:chapa', action: 'order.reject', targetType: 'order', targetId: order.id, changes: { reason: 'webhook_amount_mismatch', expected, received: paidAmount }, ip: req.ip });
        res.status(200).json({ status: 'ignored', reason: 'amount_mismatch' });
        return;
      }

      const { order: updated, autoDeliveredItem } = approveReceipt(order.id, 0);
      updateOrderStatus(order.id, updated.status, {}, { actorType: 'system', actorId: 'chapa-webhook' });
      notifyBuyerOfAutoApproval(bot, order, updated, autoDeliveredItem);
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      logger.error({ err }, 'Error processing Chapa webhook');
      res.status(500).json({ error: 'Processing failed' });
    }
  });

  // 5c. TON Connect on-chain verification (buyer's Mini App polls this).
  app.post('/api/payments/ton/status/:orderId', authenticateTelegramUserMiddleware(), async (req: Request, res: Response): Promise<void> => {
    const user = (req as any).tgUser as TelegramUser;
    const orderId = req.params.orderId as string;
    const order = getOrderById(orderId);

    if (!order || order.user_id !== user.id) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    if (!['awaiting_payment', 'new'].includes(order.status)) {
      res.json({ verified: order.status === 'fulfilled', alreadyProcessed: true });
      return;
    }
    if (!isTonConnectEnabled()) {
      res.status(400).json({ error: 'TON payments are not configured' });
      return;
    }

    const netTon = await quoteEtbToTon(Math.max(order.amount_etb - (order.discount_etb || 0), 1));
    const result = await verifyTonPayment({ memo: order.id, expectedTon: netTon });
    if (!result.verified) {
      res.json({ verified: false });
      return;
    }

    // TOCTOU re-check: the two awaits above leave a window where a concurrent
    // poll or an admin approval may have already settled this order. Re-read
    // from the database and short-circuit cleanly instead of letting
    // approveReceipt throw a confusing 500.
    const fresh = getOrderById(orderId);
    if (!fresh || !['awaiting_payment', 'new'].includes(fresh.status)) {
      res.json({
        verified: fresh?.status === 'fulfilled',
        alreadyProcessed: true,
        txHash: result.txHash,
      });
      return;
    }

    const { order: updated, autoDeliveredItem } = approveReceipt(orderId, 0);
    updateOrderStatus(orderId, updated.status, { payment_ref: `ton:${result.txHash}` }, { actorType: 'user', actorId: String(user.id) });
    notifyBuyerOfAutoApproval(bot, fresh, updated, autoDeliveredItem);
    res.json({ verified: true, txHash: result.txHash });
  });

  // 6. Submit Receipt — mounted early in the middleware chain (see top of
  // createExpressApp) so it can use its own larger body parser.

  // 7. Live Wallet Pay Webhook
  app.post('/api/wallet-pay/webhook', async (req: Request, res: Response): Promise<void> => {
    const config = getConfig();
    const signature = (req.headers['walletpay-signature'] || req.headers['wpay-signature'] || req.headers['x-wallet-pay-signature']) as string | undefined;
    const timestamp = (req.headers['walletpay-timestamp'] || req.headers['wpay-timestamp'] || req.headers['x-wallet-pay-timestamp']) as string | undefined;

    if (config.WALLET_PAY_MODE === 'live') {
      if (!signature || !timestamp) {
        res.status(401).json({ error: 'Missing Wallet Pay webhook signature headers' });
        return;
      }

      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      const isValid = verifyWalletPayWebhookSignature(
        config.WALLET_PAY_API_KEY,
        signature,
        timestamp,
        req.method,
        req.originalUrl || req.url,
        rawBody
      );

      if (!isValid) {
        logger.warn('Invalid Wallet Pay webhook signature');
        res.status(403).json({ error: 'Invalid webhook signature' });
        return;
      }
    }

    // Replay protection: reject events whose timestamp is stale or in the
    // future beyond the allowed clock skew (applies in every mode).
    if (!timestamp || !isWebhookTimestampFresh(timestamp)) {
      logger.warn({ timestamp }, 'Rejected Wallet Pay webhook with missing or stale timestamp (possible replay)');
      res.status(400).json({ error: 'Missing or expired webhook timestamp' });
      return;
    }

    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const ev of events) {
      try {
        const eventType = ev.event || ev.type;
        const payload = ev.payload || ev.data || ev;
        const externalId = payload.externalId || payload.orderId || payload.order_id || payload.customData || payload.id;
        const status = payload.status || (eventType === 'ORDER_PAID' ? 'PAID' : null);

        if (eventType === 'ORDER_PAID' || status === 'PAID' || status === 'SUCCESS') {
          if (!externalId) continue;
          const order = getOrderById(String(externalId));
          if (order && (order.status === 'awaiting_payment' || order.status === 'new' || order.status === 'pending_approval')) {

            // Amount & currency verification: the paid amount must match the
            // quote stored on the order at payment creation time. Never
            // fulfil an order for a different amount than was quoted.
            const rawPaidAmount = payload.amount?.amount ?? payload.amount;
            const paidCurrency = payload.amount?.currencyCode ?? payload.currency;
            const parsedPaidAmount = typeof rawPaidAmount === 'string' ? parseFloat(rawPaidAmount) : Number(rawPaidAmount);

            if (
              order.crypto_amount !== null &&
              order.crypto_currency !== null
            ) {
              if (!paidCurrency || paidCurrency.toUpperCase() !== String(order.crypto_currency).toUpperCase()) {
                logger.warn(
                  { orderId: order.id, expected: order.crypto_currency, received: paidCurrency },
                  'Wallet Pay event currency mismatch — order NOT fulfilled'
                );
                continue;
              }
              if (!Number.isFinite(parsedPaidAmount) || Math.abs(parsedPaidAmount - order.crypto_amount) > 0.0001) {
                logger.warn(
                  { orderId: order.id, expected: order.crypto_amount, received: parsedPaidAmount },
                  'Wallet Pay event amount mismatch — order NOT fulfilled'
                );
                continue;
              }
            } else if (!Number.isFinite(parsedPaidAmount)) {
              // No stored quote and no verifiable amount in the event:
              // fail-closed rather than fulfilling an unverifiable payment.
              logger.warn(
                { orderId: order.id },
                'Wallet Pay event lacks verifiable amount and order has no stored quote — order NOT fulfilled'
              );
              continue;
            }

            const paymentRef = payload.id ? String(payload.id) : undefined;
            const { order: updated, autoDeliveredItem } = approveReceipt(order.id, 0);
            if (paymentRef) {
              updateOrderStatus(order.id, updated.status, { payment_ref: paymentRef });
            }

            if (bot) {
              notifyBuyerOfAutoApproval(bot, order, updated, autoDeliveredItem);
            }
            logger.info({ orderId: order.id, status: updated.status }, 'Wallet Pay webhook successfully processed order');
          }
        }
      } catch (err) {
        logger.error({ err, ev }, 'Error processing Wallet Pay webhook event');
      }
    }

    res.status(200).json({ status: 'ok' });
  });

  // 8. Mount Web Admin Dashboard API Routes (with auth brute-force limits)
  app.use('/api/admin/auth/login', adminLoginLimiter);
  app.use('/api/admin/auth/verify-2fa', adminOtpLimiter);
  app.use('/api/admin', adminRouter);

  // 9. SPA HTML Fallback for direct browser links (/admin, etc.)
  if (distDir) {
    app.use((req: Request, res: Response, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

export function createApiServer(bot: Bot): http.Server {
  const app = createExpressApp(bot);
  return http.createServer(app);
}

export function startApiServer(bot: Bot, port: number = 3000): http.Server {
  const server = createApiServer(bot);
  startWalletPayReconciliation(bot, 60000);
  server.listen(port, () => {
    logger.info({ port }, `Mini App REST API listening on http://localhost:${port}`);
  });
  return server;
}
