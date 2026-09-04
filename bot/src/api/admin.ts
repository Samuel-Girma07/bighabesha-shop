import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import type { Bot } from 'grammy';
import { getConfig } from '../config/env.js';
import { getDatabase, prepared } from '../db/index.js';
import { cachedSync } from '../services/cache.service.js';
import { logger } from '../logger/index.js';
import { resolveStoredReceiptPath } from '../services/receipts.service.js';
import { createReceiptDownloadToken, verifyReceiptDownloadToken } from '../services/download_tokens.service.js';
import {
  getOrderById,
  approveReceipt,
  rejectReceipt,
  fulfillOrderWithProof,
  OutOfStockError,
} from '../services/orders.service.js';
import {
  addStockLink,
  getAvailableStockCount,
  deleteStockItem,
} from '../services/stock.service.js';
import { getAllSettings, setSetting, getSetting, isKnownSettingKey, KNOWN_SETTING_KEYS } from '../services/settings.service.js';
import { getAllUsers } from '../services/users.service.js';
import {
  getBroadcastTargets,
  getBroadcastJob,
  listBroadcastJobs,
  startBroadcastJobFromIds,
  BroadcastBusyError,
} from '../services/broadcast.service.js';
import { recordAudit, listAuditLogs } from '../services/audit.service.js';
import { csvCell, guardExcelString } from '../utils/csv.js';
import { ensureAdminRow, roleHasPermission, type AdminRole, type Permission } from '../auth/permissions.js';
import { forecastForStockProduct } from '../services/analytics.service.js';
import { monthlyPnl } from '../services/profit.service.js';
import { createPromoCode, listPromoCodes } from '../services/promo.service.js';
import { escapeHtml } from '../utils/html.js';
import { isResellerEligible, deliverWithReseller } from '../services/reseller.service.js';

export const adminRouter: Router = Router();

// Injected Bot reference for sending notifications & 2FA codes
let botInstance: Bot | null = null;

export function setAdminBotInstance(bot: Bot): void {
  botInstance = bot;
}

/**
 * Compares two strings in constant time by hashing both sides first
 * (SHA-256 normalizes length, defeating timing/length-leak attacks).
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  try {
    const hashA = crypto.createHash('sha256').update(a, 'utf-8').digest();
    const hashB = crypto.createHash('sha256').update(b, 'utf-8').digest();
    return crypto.timingSafeEqual(hashA, hashB);
  } catch {
    return false;
  }
}

// -------------------------------------------------------------
// Admin Authentication Endpoints
// -------------------------------------------------------------

// Per-admin OTP brute-force lockout. IP-based limiters alone are bypassable
// by distributed attackers rotating addresses; this gate is keyed to the
// admin identity itself. Thresholds are exposed (mutable) so tests can
// exercise lockout without exhausting IP-limiter budgets.
export const otpLockoutConfig = {
  maxAttempts: 5,
  lockoutMs: 15 * 60 * 1000,
};
const otpFailures = new Map<number, { count: number; lockedUntil: number }>();

function registerOtpFailure(adminId: number): void {
  if (otpFailures.size > 1000) otpFailures.clear(); // hard bound; admins are few
  const rec = otpFailures.get(adminId) ?? { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= otpLockoutConfig.maxAttempts) {
    rec.lockedUntil = Date.now() + otpLockoutConfig.lockoutMs;
    rec.count = 0;
    logger.warn({ adminId }, 'Admin OTP verification locked after repeated failures');
  }
  otpFailures.set(adminId, rec);
}

// Step 1: Login with Master Password -> Generates Telegram 2FA Code
adminRouter.post('/auth/login', async (req: Request, res: Response): Promise<void> => {
  const { password, adminId: requestedAdminId } = req.body;
  const config = getConfig();

  // Fail-closed: without a configured master password the dashboard stays locked.
  if (!config.ADMIN_PASSWORD) {
    res.status(503).json({ error: 'Admin dashboard is disabled: ADMIN_PASSWORD is not configured on the server.' });
    return;
  }

  if (
    typeof password !== 'string' ||
    !timingSafeEqualStrings(password, config.ADMIN_PASSWORD)
  ) {
    logger.warn({ ip: req.ip }, 'Failed admin dashboard login attempt');
    recordAudit({ adminId: 'anonymous', action: 'auth.login.failure', targetType: 'auth', targetId: String(requestedAdminId ?? ''), ip: req.ip });
    res.status(401).json({ error: 'Invalid admin credentials' });
    return;
  }

  // Only explicitly configured administrators may ever receive an OTP.
  // There is deliberately NO hardcoded fallback admin ID.
  const adminIds = config.ADMIN_IDS;
  if (adminIds.length === 0) {
    res.status(503).json({ error: 'Admin dashboard is disabled: no ADMIN_IDS configured.' });
    return;
  }

  // If a specific adminId is requested, verify it exists in ADMIN_IDS
  let targetAdminIds = adminIds;
  if (requestedAdminId !== undefined && requestedAdminId !== null) {
    const parsedId = Number(requestedAdminId);
    if (!Number.isInteger(parsedId) || !adminIds.includes(parsedId)) {
      res.status(403).json({ error: 'Provided adminId is not configured as an administrator' });
      return;
    }
    targetAdminIds = [parsedId];
  }

  // Cryptographically secure 6-digit code (Math.random() is predictable).
  const otpCode = crypto.randomInt(100_000, 1_000_000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes validity

  // Save OTP linked to each targeted admin ID in SQLite
  const db = getDatabase();
  for (const id of targetAdminIds) {
    db.prepare(`
      INSERT INTO admin_otps (admin_id, otp, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(admin_id) DO UPDATE SET
        otp = excluded.otp,
        expires_at = excluded.expires_at,
        created_at = CURRENT_TIMESTAMP
    `).run(id, otpCode, expiresAt);
  }

  // Send 2FA Code directly to Admin's Telegram private chat
  if (botInstance) {
    const msg = `🔐 <b>Admin Web Dashboard Login Request</b>\n\n` +
      `Your 6-digit verification code is:\n` +
      `<code>${otpCode}</code>\n\n` +
      `<i>Valid for 10 minutes. If you did not request this, ignore this message.</i>`;

    for (const id of targetAdminIds) {
      botInstance.api.sendMessage(id, msg, { parse_mode: 'HTML' }).catch((err: any) => {
        logger.error({ err, adminId: id }, 'Failed to send Telegram 2FA OTP code');
      });
    }
  } else {
    logger.warn({ otpCode, targetAdminIds }, 'Bot instance not bound to admin router, check console for OTP');
  }

  res.json({
    success: true,
    require2FA: true,
    adminId: targetAdminIds[0],
    adminIds: targetAdminIds,
    message: 'Verification code sent to your Telegram private chat.',
  });

  recordAudit({ adminId: targetAdminIds[0], action: 'auth.login.success', targetType: 'auth', targetId: String(targetAdminIds[0]), ip: req.ip });
});

// Step 2b: Logout — invalidates the current session server-side
adminRouter.delete('/auth/logout', requireAdminAuth, (req: Request, res: Response): void => {
  const session = (req as any).adminSession as { token: string; adminId: number };
  const db = getDatabase();
  db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(session.token);
  recordAudit({ adminId: session.adminId, action: 'auth.logout', targetType: 'auth', targetId: String(session.adminId), ip: req.ip });
  res.json({ success: true, message: 'Session terminated.' });
});

// Step 2c: Audit trail view (recent administrative activity)
adminRouter.get('/audit', requireAdminAuth, requirePermission('audit.view'), (req: Request, res: Response): void => {
  const limit = parseInt(String(req.query.limit ?? '100'), 10);
  res.json({ logs: listAuditLogs(Number.isFinite(limit) ? limit : 100) });
});

// Step 2: Verify Telegram 2FA Code -> Issues 24h Admin Session Token
adminRouter.post('/auth/verify-2fa', (req: Request, res: Response): void => {
  const { adminId, otp } = req.body;
  const targetId = Number(adminId);
  const config = getConfig();

  // No hardcoded fallback: only explicitly configured admins can verify.
  const adminIds = config.ADMIN_IDS;
  if (!Number.isInteger(targetId) || !adminIds.includes(targetId)) {
    res.status(403).json({ error: 'Unauthorized admin identifier' });
    return;
  }

  const db = getDatabase();

  // Identity-keyed brute-force gate (independent of request IP).
  const nowMs = Date.now();
  const failureRec = otpFailures.get(targetId);
  if (failureRec && failureRec.lockedUntil > nowMs) {
    const waitMin = Math.ceil((failureRec.lockedUntil - nowMs) / 60_000);
    res.status(429).json({ error: `Too many incorrect codes. Try again in ${waitMin} minute(s).` });
    return;
  }

  const entry = db.prepare('SELECT admin_id, otp, expires_at FROM admin_otps WHERE admin_id = ?').get(targetId) as {
    admin_id: number;
    otp: string;
    expires_at: number;
  } | undefined;

  if (!entry || entry.expires_at < Date.now()) {
    if (entry) db.prepare('DELETE FROM admin_otps WHERE admin_id = ?').run(targetId);
    res.status(400).json({ error: 'Verification code expired or not found. Please log in again.' });
    return;
  }

  const providedOtp = typeof otp === 'string' ? otp.trim() : String(otp ?? '');
  if (!timingSafeEqualStrings(entry.otp, providedOtp)) {
    registerOtpFailure(targetId);
    logger.warn({ adminId: targetId, ip: req.ip }, 'Incorrect OTP entered for admin dashboard login');
    res.status(400).json({ error: 'Incorrect 6-digit verification code' });
    return;
  }

  // Correct code — clear the failure counter and consume the OTP.
  otpFailures.delete(targetId);
  db.prepare('DELETE FROM admin_otps WHERE admin_id = ?').run(targetId);
  recordAudit({ adminId: targetId, action: 'auth.2fa.success', targetType: 'auth', targetId: String(targetId), ip: req.ip });

  // Generate Session Token (24h validity) in SQLite
  const token = crypto.randomBytes(32).toString('hex');
  const sessionExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
  db.prepare(`
    INSERT INTO admin_sessions (token, admin_id, expires_at)
    VALUES (?, ?, ?)
  `).run(token, targetId, sessionExpiresAt);

  res.json({
    success: true,
    token,
    admin: {
      id: targetId,
      role: ensureAdminRow(targetId) ?? 'support',
    },
  });
});

// Admin Auth Middleware (Authorization: Bearer header only).
// Query-string tokens were removed deliberately: URLs leak into proxy access
// logs, browser history, and Referer headers. Media that cannot send headers
// (e.g. <img>) must use the short-lived signed /receipt-dl/ links instead.
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    res.status(401).json({ error: 'Admin authorization token required' });
    return;
  }

  const db = getDatabase();
  const session = db.prepare('SELECT token, admin_id as adminId, expires_at as expiresAt FROM admin_sessions WHERE token = ?').get(token) as {
    token: string;
    adminId: number;
    expiresAt: number;
  } | undefined;

  if (!session || session.expiresAt < Date.now()) {
    if (session) db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
    res.status(401).json({ error: 'Session expired. Please log in again.' });
    return;
  }

  // RBAC: resolve role (self-healing backfill for legacy ADMIN_IDS members).
  const role = ensureAdminRow(session.adminId);
  if (!role) {
    logger.warn({ adminId: session.adminId }, 'Session belongs to a deactivated administrator');
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
    recordAudit({ adminId: session.adminId, action: 'auth.login.failure', targetType: 'auth', targetId: String(session.adminId), changes: { reason: 'deactivated' }, ip: req.ip });
    res.status(403).json({ error: 'Administrator account is deactivated.' });
    return;
  }

  (req as any).adminSession = session;
  (req as any).adminRole = role as AdminRole;
  next();
}

/** Route guard: requires the session's role to hold a specific permission. */
export function requirePermission(perm: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = (req as any).adminRole as AdminRole | undefined;
    if (!role || !roleHasPermission(role, perm)) {
      recordAudit({
        adminId: (req as any).adminSession?.adminId ?? 'unknown',
        action: 'auth.login.failure',
        targetType: 'authz',
        targetId: perm,
        changes: { deniedPermission: perm, role: role ?? 'none', path: req.path },
        ip: req.ip,
      });
      res.status(403).json({ error: `Insufficient permissions for ${perm}` });
      return;
    }
    next();
  };
}

// -------------------------------------------------------------
// Protected Dashboard Endpoints
// -------------------------------------------------------------

// 1. Overview & Analytics Metrics (Real Database Data)
adminRouter.get('/overview', requireAdminAuth, requirePermission('analytics.view'), (req: Request, res: Response): void => {
  const timeRange = (req.query.range as string) || '6M';
  const rail = (req.query.rail as string) || 'all';

  const data = cachedSync(`admin:overview:${timeRange}:${rail}`, 30_000, () => {
    const railFilter = rail !== 'all' ? ' AND payment_rail = ?' : '';
    const railParams = rail !== 'all' ? [rail] : [];

    // 1. Total lifetime revenue from fulfilled orders
    const totalRevSql = `SELECT COALESCE(SUM(amount_etb), 0) as total FROM orders WHERE status = 'fulfilled'${railFilter}`;
    const totalRevenue = (rail !== 'all' ? prepared(totalRevSql).get(...railParams) : prepared(totalRevSql).get()) as { total: number };

    // 2. Orders status breakdown
    const ordersCountSql = `SELECT COUNT(*) as total, ` +
      `SUM(CASE WHEN status = 'fulfilled' THEN 1 ELSE 0 END) as fulfilled, ` +
      `SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) as pendingApproval, ` +
      `SUM(CASE WHEN status = 'pending_fulfillment' THEN 1 ELSE 0 END) as pendingFulfillment, ` +
      `SUM(CASE WHEN status = 'awaiting_payment' THEN 1 ELSE 0 END) as awaitingPayment ` +
      `FROM orders WHERE 1=1${railFilter}`;
    const ordersCount = (rail !== 'all' ? prepared(ordersCountSql).get(...railParams) : prepared(ordersCountSql).get()) as any;

    // 3. User counts
    const usersCount = prepared(
      "SELECT COUNT(*) as total, SUM(CASE WHEN is_registered = 1 THEN 1 ELSE 0 END) as registered FROM users"
    ).get() as any;

    // 4. Gemini Stock
    const geminiStock = getAvailableStockCount('gemini_pro_18m');

    // 5. Payment Rail Breakdown
    const railBreakdown = prepared(
      "SELECT payment_rail, COUNT(*) as count, SUM(amount_etb) as total_etb FROM orders WHERE status = 'fulfilled' GROUP BY payment_rail"
    ).all();

    // 6. Product Revenue Breakdown
    const productStats = [
      { id: 'gemini_pro_18m', name: 'Gemini Pro (18M)', code: 'GEMINI' },
      { id: 'telegram_premium', name: 'Telegram Premium', code: 'PREM' },
    ].map((p) => {
      const pSql = `SELECT COUNT(*) as units, COALESCE(SUM(amount_etb), 0) as revenue FROM orders WHERE product_id = ? AND status = 'fulfilled'${railFilter}`;
      const row = (rail !== 'all' ? prepared(pSql).get(p.id, ...railParams) : prepared(pSql).get(p.id)) as { units: number; revenue: number };
      const pct = totalRevenue.total > 0 ? ((row.revenue / totalRevenue.total) * 100).toFixed(1) : '0';
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        units: row.units || 0,
        revenue: row.revenue || 0,
        pctOfTotal: `${pct}%`,
      };
    });

    // 7. Dynamic Timeline Chart Data based on timeRange & rail (aligned to Ethiopian Local Time UTC+3)
    const chartPoints: { label: string; revenue: number; orders: number }[] = [];

    if (timeRange === '1D') {
      // 3-hour intervals for today in Ethiopian Local Time (UTC+3)
      for (let h = 0; h < 24; h += 3) {
        const hourStr = h.toString().padStart(2, '0');
        const startH = h;
        const endH = h + 3;
        const hSql = `SELECT COALESCE(SUM(amount_etb), 0) as rev, COUNT(*) as count FROM orders WHERE status = 'fulfilled' AND date(created_at, '+3 hours') = date('now', '+3 hours') AND CAST(strftime('%H', datetime(created_at, '+3 hours')) AS INTEGER) >= ? AND CAST(strftime('%H', datetime(created_at, '+3 hours')) AS INTEGER) < ?${railFilter}`;
        const row = (rail !== 'all' ? prepared(hSql).get(startH, endH, ...railParams) : prepared(hSql).get(startH, endH)) as any;
        chartPoints.push({
          label: `${hourStr}:00`,
          revenue: row?.rev || 0,
          orders: row?.count || 0,
        });
      }
    } else if (timeRange === '1W') {
      // Last 7 days in Ethiopian Local Time (UTC+3)
      for (let d = 6; d >= 0; d--) {
        const nowUtc3 = new Date(Date.now() + 3 * 60 * 60 * 1000);
        nowUtc3.setUTCDate(nowUtc3.getUTCDate() - d);
        const dateStr = nowUtc3.toISOString().split('T')[0];
        const dayLabel = nowUtc3.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
        const dSql = `SELECT COALESCE(SUM(amount_etb), 0) as rev, COUNT(*) as count FROM orders WHERE status = 'fulfilled' AND date(created_at, '+3 hours') = date(?)${railFilter}`;
        const row = (rail !== 'all' ? prepared(dSql).get(dateStr, ...railParams) : prepared(dSql).get(dateStr)) as any;
        chartPoints.push({
          label: dayLabel,
          revenue: row?.rev || 0,
          orders: row?.count || 0,
        });
      }
    } else if (timeRange === '1M') {
      // 4 Weeks in Ethiopian Local Time (UTC+3)
      for (let w = 3; w >= 0; w--) {
        const weekLabel = `W${4 - w}`;
        const startDaysAgo = (w + 1) * 7;
        const endDaysAgo = w * 7;
        const wSql = `SELECT COALESCE(SUM(amount_etb), 0) as rev, COUNT(*) as count FROM orders WHERE status = 'fulfilled' AND datetime(created_at, '+3 hours') >= datetime('now', '+3 hours', '-' || ? || ' days') AND datetime(created_at, '+3 hours') < datetime('now', '+3 hours', '-' || ? || ' days')${railFilter}`;
        const row = (rail !== 'all' ? prepared(wSql).get(startDaysAgo, endDaysAgo, ...railParams) : prepared(wSql).get(startDaysAgo, endDaysAgo)) as any;
        chartPoints.push({
          label: weekLabel,
          revenue: row?.rev || 0,
          orders: row?.count || 0,
        });
      }
    } else {
      // 6M or 1Y: Monthly buckets in Ethiopian Local Time (UTC+3)
      const monthsCount = timeRange === '1Y' ? 12 : 6;
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const nowUtc3 = new Date(Date.now() + 3 * 60 * 60 * 1000);
      for (let i = monthsCount - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(nowUtc3.getUTCFullYear(), nowUtc3.getUTCMonth() - i, 1));
        const mIdx = d.getUTCMonth();
        const monthLabel = months[mIdx];
        const monthFormatted = (mIdx + 1).toString().padStart(2, '0');
        const yearStr = d.getUTCFullYear().toString();

        const mSql = `SELECT COALESCE(SUM(amount_etb), 0) as rev, COUNT(*) as count FROM orders WHERE status = 'fulfilled' AND strftime('%m', datetime(created_at, '+3 hours')) = ? AND strftime('%Y', datetime(created_at, '+3 hours')) = ?${railFilter}`;
        const row = (rail !== 'all' ? prepared(mSql).get(monthFormatted, yearStr, ...railParams) : prepared(mSql).get(monthFormatted, yearStr)) as any;

        chartPoints.push({
          label: monthLabel,
          revenue: row?.rev || 0,
          orders: row?.count || 0,
        });
      }
    }

    // 8. Recent 5 orders
    const recSql = `SELECT id, user_id, username, product_id, amount_etb, payment_rail, status, created_at FROM orders WHERE 1=1${railFilter} ORDER BY created_at DESC LIMIT 5`;
    const recentOrders = (rail !== 'all' ? prepared(recSql).all(...railParams) : prepared(recSql).all()) as any[];

    return {
      metrics: {
        totalRevenueETB: totalRevenue.total,
        totalOrders: ordersCount.total || 0,
        fulfilledOrders: ordersCount.fulfilled || 0,
        pendingApprovalOrders: ordersCount.pendingApproval || 0,
        pendingFulfillmentOrders: ordersCount.pendingFulfillment || 0,
        awaitingPaymentOrders: ordersCount.awaitingPayment || 0,
        totalUsers: usersCount.total || 0,
        registeredUsers: usersCount.registered || 0,
        geminiStockAvailable: geminiStock,
      },
      productStats,
      chartPoints,
      railBreakdown,
      recentOrders,
    };
  });

  res.json(data);
});

// 2. Orders List & Management
adminRouter.get('/orders', requireAdminAuth, requirePermission('orders.view'), (req: Request, res: Response): void => {
  const db = getDatabase();
  const statusFilter = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;

  let query = 'SELECT * FROM orders';
  const params: any[] = [];
  const clauses: string[] = [];

  if (statusFilter && statusFilter !== 'all') {
    clauses.push('status = ?');
    params.push(statusFilter);
  }

  if (search) {
    clauses.push('(id LIKE ? OR username LIKE ? OR product_id LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (clauses.length > 0) {
    query += ' WHERE ' + clauses.join(' AND ');
  }

  query += ' ORDER BY created_at DESC LIMIT 100';

  const orders = db.prepare(query).all(...params);
  res.json({ orders });
});

// 2b. View / Stream Order Receipt Image (supports disk-stored uploads and Telegram bot file_ids)
//
// Shared streaming logic for BOTH authenticated transports:
//   - GET /orders/:id/receipt       (Authorization: Bearer — API clients)
//   - GET /receipt-dl/:payload/:sig (signed one-time URL — <img>/<a> tags)
async function serveOrderReceipt(orderId: string, res: Response): Promise<void> {
  const order = getOrderById(orderId);
  if (!order || !order.receipt_file_id) {
    res.status(404).json({ error: 'Receipt not found' });
    return;
  }

  const fileId = order.receipt_file_id;

  // Case 1: Legacy inline base64 data URL.
  // Only raster image MIME types may ever be rendered inline — anything else
  // is downgraded to an inert octet stream so a crafted data URL (e.g. SVG
  // carrying scripts) can never execute in an admin's browser.
  if (fileId.startsWith('data:image/')) {
    const parts = fileId.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const rawMime = (mimeMatch?.[1] || 'image/png').toLowerCase();
    const safeMime = ['image/jpeg', 'image/png', 'image/webp'].includes(rawMime)
      ? rawMime
      : 'application/octet-stream';
    const ext = safeMime === 'image/jpeg' ? 'jpg' : safeMime === 'image/png' ? 'png' : safeMime === 'image/webp' ? 'webp' : 'bin';
    const buffer = Buffer.from(parts[1], 'base64');
    res.setHeader('Content-Type', safeMime);
    res.setHeader('Content-Disposition', `inline; filename="receipt.${ext}"`);
    res.send(buffer);
    return;
  }

  // Case 2: Saved file on disk — resolved through the traversal-safe helper
  // which accepts both current filename-only ids and legacy absolute paths,
  // and refuses anything escaping the receipts root.
  const diskPath = resolveStoredReceiptPath(fileId);
  if (diskPath) {
    res.sendFile(diskPath);
    return;
  }

  // Case 3: Telegram File ID (uploaded via bot chat)
  try {
    const config = getConfig();
    if (botInstance) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      try {
        const file = await Promise.race([
          botInstance.api.getFile(fileId),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('getFile timeout')), 5000)),
        ]);
        if (file && file.file_path) {
          const telegramFileUrl = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
          const resp = await fetch(telegramFileUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (resp.ok) {
            const contentType = resp.headers.get('content-type') || 'image/jpeg';
            res.setHeader('Content-Type', contentType);
            const arrayBuf = await resp.arrayBuffer();
            res.send(Buffer.from(arrayBuf));
            return;
          }
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }
  } catch (err: any) {
    logger.error({ err: err.message || err, orderId, fileId }, 'Failed to stream receipt from Telegram Bot API');
  }

  res.status(404).json({ error: 'Receipt image not found' });
}

adminRouter.get('/orders/:id/receipt', requireAdminAuth, requirePermission('orders.view'), async (req: Request, res: Response): Promise<void> => {
  await serveOrderReceipt(req.params.id as string, res);
});

/**
 * Issues a short-lived signed download URL for a receipt. Replaces the old
 * "?token=<session>" pattern, which leaked the long-lived admin session into
 * proxy logs, browser history, and Referer headers.
 */
adminRouter.get('/orders/:id/receipt-link', requireAdminAuth, requirePermission('orders.view'), (req: Request, res: Response): void => {
  const order = getOrderById(req.params.id as string);
  if (!order || !order.receipt_file_id) {
    res.status(404).json({ error: 'Receipt not found' });
    return;
  }
  const token = createReceiptDownloadToken(order.id);
  res.json({ url: token.url, expiresIn: token.expiresIn });
});

// Signed download endpoint — auth is carried by the HMAC payload itself
// (purpose-bound, order-bound, 60s TTL). Mounted on the admin router but
// deliberately NOT behind requireAdminAuth.
adminRouter.get('/receipt-dl/:payload/:sig', async (req: Request, res: Response): Promise<void> => {
  const orderId = verifyReceiptDownloadToken(
    req.params.payload as string,
    req.params.sig as string
  );
  if (!orderId) {
    res.status(403).json({ error: 'Invalid or expired download link' });
    return;
  }
  await serveOrderReceipt(orderId, res);
});

// 3. Approve Receipt
adminRouter.post('/orders/:id/approve', requireAdminAuth, requirePermission('orders.decide'), async (req: Request, res: Response): Promise<void> => {
  const orderId = req.params.id as string;
  const adminId = (req as any).adminSession.adminId;

  try {
    const { order, autoDeliveredItem } = approveReceipt(orderId, adminId);
    recordAudit({ adminId, action: 'order.approve', targetType: 'order', targetId: orderId, changes: { newStatus: order.status, autoDelivered: Boolean(autoDeliveredItem) }, ip: req.ip });

    let finalOrder = order;

    if (!autoDeliveredItem && isResellerEligible(order)) {
      const outcome = await deliverWithReseller(order.id, adminId, botInstance?.api);
      if (outcome.delivered && botInstance?.api) {
        const buyerMsg = `🎉 <b>Payment Verified & Order Fulfilled!</b>\n\n` +
          `Your Telegram Premium has been activated on <b>@${escapeHtml(order.target_username || order.username || '')}</b>.\n\n` +
          `<i>Thank you for choosing Bighabesha Shop.</i>`;
        await botInstance.api.sendMessage(order.user_id, buyerMsg, { parse_mode: 'HTML' }).catch(() => {});
      }
      finalOrder = outcome.order;
    } else if (botInstance) {
      if (autoDeliveredItem) {
        const rawTemplate = getSetting(
          'gemini_instructions',
          '1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.'
        );
        const deliveryText = `<b>Payment Confirmed — Order #${order.id}</b>\n\n` +
          `Activation Link:\n<code>${autoDeliveredItem.payload}</code>\n\n` +
          `<b>Instructions:</b>\n${rawTemplate}\n\n` +
          `<i>Thank you for choosing Bighabesha Shop.</i>`;

        botInstance.api.sendMessage(order.user_id, deliveryText, { parse_mode: 'HTML' }).catch(() => {});
      } else {
        const notifyText = `<b>Payment Verified for Order #${order.id}</b>\n\n` +
          `Your order has been verified and queued for fulfillment to <b>@${order.username || 'your account'}</b>.`;

        botInstance.api.sendMessage(order.user_id, notifyText, { parse_mode: 'HTML' }).catch(() => {});
      }
    }

    res.json({ success: true, order: finalOrder, autoDeliveredItem });
  } catch (err: any) {
    if (err instanceof OutOfStockError) {
      res.status(409).json({ error: err.message });
      return;
    }
    res.status(400).json({ error: err.message });
  }
});

// 4. Reject Receipt
adminRouter.post('/orders/:id/reject', requireAdminAuth, requirePermission('orders.decide'), (req: Request, res: Response): void => {
  const orderId = req.params.id as string;
  const adminId = (req as any).adminSession.adminId;
  const { reason } = req.body;

  try {
    const order = rejectReceipt(orderId, adminId, reason || 'Payment receipt not accepted.');
    recordAudit({ adminId, action: 'order.reject', targetType: 'order', targetId: orderId, changes: { reason: order.rejection_reason }, ip: req.ip });

    if (botInstance) {
      const rejectText = `<b>Order #${order.id} Update</b>\n\n` +
        `Your transfer receipt was not accepted.\n` +
        `<b>Reason:</b> ${order.rejection_reason}\n\n` +
        `Please contact support (@${getConfig().SUPPORT_USERNAME}) if you have any questions.`;

      botInstance.api.sendMessage(order.user_id, rejectText, { parse_mode: 'HTML' }).catch(() => {});
    }

    res.json({ success: true, order });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Complete Manual Fulfillment (Premium / Stars)
adminRouter.post('/orders/:id/fulfill', requireAdminAuth, requirePermission('orders.decide'), (req: Request, res: Response): void => {
  const orderId = req.params.id as string;
  const adminId = (req as any).adminSession.adminId;
  const { proofNote } = req.body;

  try {
    const order = fulfillOrderWithProof(orderId, adminId, { text: proofNote || 'Delivered via Fragment official rails.' });
    recordAudit({ adminId, action: 'order.fulfill', targetType: 'order', targetId: orderId, ip: req.ip });

    if (botInstance) {
      const fulfillText = `<b>Order #${order.id} Delivered Successfully</b>\n\n` +
        `Your subscription / stars order has been completed!\n` +
        `• <b>Delivered To:</b> @${order.username || 'your account'}\n` +
        `• <b>Reference:</b> ${order.fulfillment_proof}\n\n` +
        `<i>Thank you for choosing Bighabesha Shop.</i>`;

      botInstance.api.sendMessage(order.user_id, fulfillText, { parse_mode: 'HTML' }).catch(() => {});
    }

    res.json({ success: true, order });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Gemini Stock Inventory
adminRouter.get('/stock', requireAdminAuth, requirePermission('stock.manage'), (_req: Request, res: Response): void => {
  const db = getDatabase();
  const items = db.prepare(
    "SELECT * FROM stock_items WHERE product_id = 'gemini_pro_18m' ORDER BY created_at DESC"
  ).all() as any[];

  const summary = {
    available: items.filter((i: any) => i.status === 'available').length,
    allocated: items.filter((i: any) => i.status === 'allocated').length,
    total: items.length,
  };

  res.json({ summary, items });
});

adminRouter.post(['/stock', '/stock/bulk'], requireAdminAuth, requirePermission('stock.manage'), (req: Request, res: Response): void => {
  const { linksText, links } = req.body;
  const rawText = linksText || links;
  if (!rawText || typeof rawText !== 'string') {
    res.status(400).json({ error: 'Please provide at least one activation link.' });
    return;
  }

  const lines: string[] = (rawText as string)
    .split(/[\r\n]+/)
    .map((l: string) => l.trim())
    .filter((l: string) => l.length > 0);

  if (lines.length === 0) {
    res.status(400).json({ error: 'No valid links found in input.' });
    return;
  }

  const db = getDatabase();
  let addedCount = 0;
  let duplicateCount = 0;
  const seenInBatch = new Set<string>();

  for (const link of lines) {
    if (seenInBatch.has(link)) {
      duplicateCount++;
      continue;
    }
    seenInBatch.add(link);

    const existing = db.prepare('SELECT id FROM stock_items WHERE payload = ?').get(link);
    if (existing) {
      duplicateCount++;
      continue;
    }

    try {
      addStockLink('gemini_pro_18m', link);
      addedCount++;
    } catch {
      duplicateCount++;
    }
  }

  recordAudit({ adminId: (req as any).adminSession?.adminId ?? 'unknown', action: 'stock.add', targetType: 'stock', targetId: 'gemini_pro_18m', changes: { addedCount, duplicateCount, submittedLines: lines.length }, ip: req.ip });

  if (addedCount === 0 && duplicateCount > 0) {
    res.status(400).json({
      error: `All ${duplicateCount} link(s) submitted are already present in stock. Duplicate links were rejected.`,
      addedCount: 0,
      duplicateCount,
    });
    return;
  }

  res.json({
    success: true,
    addedCount,
    duplicateCount,
    message: duplicateCount > 0
      ? `Added ${addedCount} new link(s) (${duplicateCount} duplicate links skipped)`
      : `Added ${addedCount} activation links to stock`,
  });
});

adminRouter.delete('/stock/:id', requireAdminAuth, requirePermission('stock.manage'), (req: Request, res: Response): void => {
  const itemId = req.params.id as string;
  const deleted = deleteStockItem(itemId);
  if (deleted) {
    recordAudit({ adminId: (req as any).adminSession?.adminId ?? 'unknown', action: 'stock.delete', targetType: 'stock_item', targetId: String(itemId), ip: req.ip });
  }
  if (!deleted) {
    res.status(400).json({ error: 'Cannot delete item (may already be allocated or not found)' });
    return;
  }
  res.json({ success: true });
});

// 7. User Directory & CRM
adminRouter.get('/users', requireAdminAuth, requirePermission('users.view'), (_req: Request, res: Response): void => {
  const users = getAllUsers();
  res.json({ users });
});

// 8. Settings Management
adminRouter.get('/settings', requireAdminAuth, requirePermission('settings.read'), (_req: Request, res: Response): void => {
  const settings = getAllSettings();
  res.json({ settings });
});

adminRouter.put('/settings', requireAdminAuth, requirePermission('settings.write'), (req: Request, res: Response): void => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    res.status(400).json({ error: 'Invalid settings object' });
    return;
  }

  // Reject unknown keys outright — a typo'd key would otherwise be stored
  // silently and shadow nothing, while the real knob keeps its old value.
  const unknownKeys = Object.keys(settings).filter((k) => !isKnownSettingKey(k));
  if (unknownKeys.length > 0) {
    res.status(400).json({
      error: `Unknown setting key(s): ${unknownKeys.join(', ')}. Valid keys: ${[...KNOWN_SETTING_KEYS].sort().join(', ')}`,
    });
    return;
  }

  const changedKeys = Object.keys(settings);
  for (const [key, val] of Object.entries(settings)) {
    setSetting(key, String(val));
  }

  recordAudit({
    adminId: (req as any).adminSession?.adminId ?? 'unknown',
    action: 'settings.update',
    targetType: 'setting',
    targetId: changedKeys.join(','),
    changes: settings,
    ip: req.ip,
  });

  res.json({ success: true, settings: getAllSettings() });
});

// 9. Broadcast Announcement (background job — never blocks the request)
adminRouter.post('/broadcast', requireAdminAuth, requirePermission('broadcast.send'), (req: Request, res: Response): void => {
  const { message, target, photoFileId } = req.body;
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'Broadcast message content is required' });
    return;
  }
  if (photoFileId !== undefined && photoFileId !== null && typeof photoFileId !== 'string') {
    res.status(400).json({ error: 'photoFileId must be a Telegram file_id string' });
    return;
  }

  const targetLanguage = typeof target === 'string' ? target : 'all';
  const targets = getBroadcastTargets(targetLanguage === 'active_buyers' ? 'all' : targetLanguage);

  // 'active_buyers' targeting is applied via a dedicated target list.
  const db = getDatabase();
  let recipientIds: number[];
  if (target === 'active_buyers') {
    recipientIds = (db.prepare("SELECT DISTINCT user_id as id FROM orders WHERE status = 'fulfilled'").all() as any[]).map((r) => r.id);
  } else if (target === 'registered') {
    recipientIds = (db.prepare('SELECT id FROM users WHERE is_registered = 1').all() as any[]).map((r) => r.id);
  } else {
    recipientIds = targets.map((t) => t.id);
  }

  if (!botInstance) {
    res.status(503).json({ error: 'Bot instance unavailable — cannot dispatch broadcast' });
    return;
  }

  // Deliver through the resilient background runner with per-user isolation,
  // chunking, and rate-limit pacing. The HTTP request returns instantly.
  recordAudit({ adminId: (req as any).adminSession?.adminId ?? 'unknown', action: 'broadcast.start', targetType: 'broadcast', targetId: targetLanguage, changes: { totalTargeted: recipientIds.length, hasPhoto: Boolean(photoFileId), messagePreview: message.slice(0, 80) }, ip: req.ip });

  let job;
  try {
    job = startBroadcastJobFromIds(botInstance.api, {
      recipientIds,
      messageText: message,
      photoFileId: photoFileId || undefined,
    });
  } catch (err) {
    if (err instanceof BroadcastBusyError) {
      res.status(429).json({ error: err.message });
      return;
    }
    throw err;
  }

  res.status(202).json({
    success: true,
    jobId: job.id,
    totalTargeted: job.total,
    statusUrl: `/api/admin/broadcast/status/${job.id}`,
    message: 'Broadcast queued for delivery.',
  });
});

adminRouter.get('/broadcast/status/:jobId', requireAdminAuth, requirePermission('broadcast.send'), (req: Request, res: Response): void => {
  const job = getBroadcastJob(req.params.jobId as string);
  if (!job) {
    res.status(404).json({ error: 'Broadcast job not found' });
    return;
  }
  res.json({ job });
});

adminRouter.get('/broadcast/jobs', requireAdminAuth, requirePermission('broadcast.send'), (_req: Request, res: Response): void => {
  res.json({ jobs: listBroadcastJobs() });
});

// =============================================================
// Phase 4/5 extensions: payouts, promos, exports, enriched overview
// =============================================================

import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

type AdminSessionRequest = Request & { adminSession?: { adminId: number }; adminRole?: AdminRole };

// --- Referral payout queue (finance / superadmin) ---------------------------
adminRouter.get('/payouts', requireAdminAuth, requirePermission('payouts.manage'), (req: Request, res: Response): void => {
  const status = String(req.query.status ?? 'pending');
  const rows = getDatabase().prepare(
    'SELECT * FROM payout_requests WHERE status = ? ORDER BY id ASC LIMIT 200'
  ).all(status);
  res.json({ payouts: rows });
});

adminRouter.post('/payouts/:id/decision', requireAdminAuth, requirePermission('payouts.manage'), (req: Request, res: Response): void => {
  const adminReq = req as AdminSessionRequest;
  const id = parseInt(req.params.id as string, 10);
  const decision = String(req.body?.decision || '');
  if (!['paid', 'rejected'].includes(decision)) {
    res.status(400).json({ error: "decision must be 'paid' or 'rejected'" });
    return;
  }

  const db = getDatabase();
  const payout = db.prepare('SELECT * FROM payout_requests WHERE id = ?').get(id) as any;
  if (!payout) { res.status(404).json({ error: 'Payout not found' }); return; }

  const adminId = adminReq.adminSession!.adminId;

  // Atomic claim: the conditional UPDATE is the single source of truth for
  // "still pending". Two admins racing on the same request (or two processes
  // sharing the DB) can never both win — the loser gets a clean 409.
  const claim = db
    .prepare('UPDATE payout_requests SET status = ?, processed_by = ? WHERE id = ? AND status = ?')
    .run(decision, adminId, id, 'pending');

  if (claim.changes === 0) {
    res.status(409).json({ error: 'Payout already processed' });
    return;
  }

  if (decision === 'paid') {
    // Settle the ledger: debit the commission balance.
    db.prepare(`
      INSERT INTO ledger_entries (user_id, direction, amount_etb, type, idempotency_key, note)
      VALUES (?, 'debit', ?, 'payout', ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `).run(payout.user_id, payout.amount_etb, `payout:${id}`, `Payout #${id}`);
  }

  recordAudit({
    adminId, action: 'payout.decision', targetType: 'payout', targetId: String(id),
    changes: { decision, userId: payout.user_id, amountEtb: payout.amount_etb }, ip: req.ip,
  });

  if (botInstance) {
    const msg = decision === 'paid'
      ? `💸 Your payout request of ${payout.amount_etb.toLocaleString('en-US')} ETB has been <b>PAID</b> via ${payout.method}.`
      : `❌ Your payout request of ${payout.amount_etb.toLocaleString('en-US')} ETB was declined. Contact support for details.`;
    botInstance.api.sendMessage(payout.user_id, msg, { parse_mode: 'HTML' }).catch(() => {});
  }

  res.json({ success: true });
});

// --- Promo code management (ops / superadmin) --------------------------------
adminRouter.get('/promos', requireAdminAuth, requirePermission('stock.manage'), (_req: Request, res: Response): void => {
  res.json({ promos: listPromoCodes() });
});

adminRouter.post('/promos', requireAdminAuth, requirePermission('stock.manage'), (req: Request, res: Response): void => {
  try {
    const created = createPromoCode({
      code: String(req.body.code || ''),
      kind: req.body.kind === 'flat' ? 'flat' : 'pct',
      value: Number(req.body.value),
      maxUses: req.body.maxUses != null ? Number(req.body.maxUses) : null,
      perUserLimit: req.body.perUserLimit != null ? Number(req.body.perUserLimit) : 1,
      expiresAt: req.body.expiresAt || null,
      minAmountEtb: req.body.minAmountEtb != null ? Number(req.body.minAmountEtb) : 0,
      productScope: Array.isArray(req.body.productScope) ? req.body.productScope : [],
    });
    recordAudit({ adminId: (req as any).adminSession?.adminId ?? 'unknown', action: 'settings.update', targetType: 'promo', targetId: String(created.id), changes: { code: created.code }, ip: req.ip });
    res.json({ success: true, promo: created });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// --- Enriched overview: profit + restock forecast -----------------------------
adminRouter.get('/insights/restock', requireAdminAuth, requirePermission('analytics.view'), (_req: Request, res: Response): void => {
  const db = getDatabase();
  const stockProducts = db.prepare("SELECT id, name FROM products WHERE type = 'stock' AND is_active = 1").all() as any[];
  const forecasts = stockProducts.map((p) => forecastForStockProduct(p.id, getAvailableStockCount(p.id)));
  res.json({ forecasts });
});

adminRouter.get('/insights/pnl', requireAdminAuth, requirePermission('analytics.view'), (req: Request, res: Response): void => {
  const months = Math.min(Math.max(parseInt(String(req.query.months ?? '12'), 10) || 12, 1), 24);
  res.json({ pnl: monthlyPnl(months) });
});

// --- Financial exports (finance / superadmin) ---------------------------------
function fetchFulfilledOrders(): any[] {
  return getDatabase().prepare(
    "SELECT * FROM orders WHERE status = 'fulfilled' ORDER BY created_at DESC LIMIT 10000"
  ).all();
}

adminRouter.get('/export/orders.csv', requireAdminAuth, requirePermission('export.financial'), (_req: Request, res: Response): void => {
  const orders = fetchFulfilledOrders();
  const header = ['order_id','created_at','user_id','username','product_id','variant_id','quantity','amount_etb','discount_etb','promo_code','payment_rail','payment_ref'];
  const lines = [header.join(',')];
  for (const o of orders) {
    lines.push(header.map((h) => csvCell((o as any)[h])).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="orders_fulfilled.csv"');
  res.send('\ufeff' + lines.join('\n'));
});

adminRouter.get('/export/orders.xlsx', requireAdminAuth, requirePermission('export.financial'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Bighabesha Shop Admin';
    const sheet = workbook.addWorksheet('Fulfilled Orders');
    sheet.columns = [
      { header: 'Order ID', key: 'id', width: 22 },
      { header: 'Created', key: 'created_at', width: 20 },
      { header: 'User ID', key: 'user_id', width: 14 },
      { header: 'Username', key: 'username', width: 18 },
      { header: 'Product', key: 'product_id', width: 22 },
      { header: 'Variant', key: 'variant_id', width: 24 },
      { header: 'Qty', key: 'quantity', width: 8 },
      { header: 'Amount ETB', key: 'amount_etb', width: 14 },
      { header: 'Discount ETB', key: 'discount_etb', width: 14 },
      { header: 'Promo', key: 'promo_code', width: 14 },
      { header: 'Rail', key: 'payment_rail', width: 14 },
      { header: 'Payment Ref', key: 'payment_ref', width: 28 },
    ];
    for (const o of fetchFulfilledOrders()) sheet.addRow(guardExcelString(o));

    const pnlSheet = workbook.addWorksheet('Monthly P&L');
    pnlSheet.columns = [
      { header: 'Period', key: 'period', width: 12 },
      { header: 'Orders', key: 'orders', width: 10 },
      { header: 'Gross ETB', key: 'grossEtb', width: 14 },
      { header: 'Discounts', key: 'discountsEtb', width: 12 },
      { header: 'COGS ETB', key: 'cogsEtb', width: 14 },
      { header: 'Rail Fees', key: 'railFeesEtb', width: 12 },
      { header: 'Net Profit ETB', key: 'netProfitEtb', width: 16 },
    ];
    for (const row of monthlyPnl(12)) pnlSheet.addRow(row);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="financial_report.xlsx"');
    await workbook.xlsx.write(res).then(() => res.end());
  } catch (err) {
    logger.error({ err }, 'XLSX export failed');
    res.status(500).json({ error: 'Export failed' });
  }
});

adminRouter.get('/export/pnl.pdf', requireAdminAuth, requirePermission('export.financial'), (_req: Request, res: Response): void => {
  try {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="monthly_pnl.pdf"');
    doc.pipe(res);

    doc.fontSize(18).fillColor('#111').text('Bighabesha Shop — Monthly P&L', { underline: false });
    doc.moveDown(0.3).fontSize(9).fillColor('#666').text(`Generated ${new Date().toISOString()}`).moveDown();

    const rows = monthlyPnl(12);
    if (rows.length === 0) {
      doc.fontSize(11).fillColor('#333').text('No fulfilled orders in the last 12 months.');
    } else {
      doc.fontSize(10).fillColor('#000');
      doc.text('Period     Orders   Gross ETB   COGS ETB   Fees ETB   Net ETB', { continued: false });
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#ccc').stroke();
      for (const r of rows) {
        doc.text(
          `${r.period}   ${String(r.orders).padStart(5)}   ${String(r.grossEtb).padStart(9)}   ${String(r.cogsEtb).padStart(8)}   ${String(r.railFeesEtb).padStart(8)}   ${String(r.netProfitEtb).padStart(8)}`
        );
      }
    }
    doc.end();
  } catch (err) {
    logger.error({ err }, 'PDF export failed');
    if (!res.headersSent) res.status(500).json({ error: 'Export failed' });
  }
});
