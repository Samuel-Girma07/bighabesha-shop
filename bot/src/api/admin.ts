import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getConfig } from '../config/env.js';
import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';
import {
  getOrderById,
  approveReceipt,
  rejectReceipt,
  fulfillOrderWithProof,
  Order,
} from '../services/orders.service.js';
import {
  addStockLink,
  getAvailableStockCount,
  deleteStockItem,
} from '../services/stock.service.js';
import { getAllSettings, setSetting, getSetting } from '../services/settings.service.js';
import { getAllUsers } from '../services/users.service.js';

export const adminRouter: Router = Router();

// In-memory 2FA & Session store
interface OtpEntry {
  otp: string;
  expiresAt: number;
}

interface AdminSession {
  token: string;
  adminId: number;
  expiresAt: number;
}

const otpStore = new Map<number, OtpEntry>();
const sessionsStore = new Map<string, AdminSession>();

// Injected Bot reference for sending notifications & 2FA codes
let botInstance: any = null;

export function setAdminBotInstance(bot: any): void {
  botInstance = bot;
}

// -------------------------------------------------------------
// Admin Authentication Endpoints
// -------------------------------------------------------------

// Step 1: Login with Master Password -> Generates Telegram 2FA Code
adminRouter.post('/auth/login', async (req: Request, res: Response): Promise<void> => {
  const { password } = req.body;
  const config = getConfig();

  if (!password || password !== config.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Invalid admin credentials' });
    return;
  }

  const primaryAdminId = config.ADMIN_IDS[0] || 1397163638;
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

  // Save OTP (10 minutes validity)
  otpStore.set(primaryAdminId, {
    otp: otpCode,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  // Send 2FA Code directly to Admin's Telegram private chat
  if (botInstance) {
    const msg = `🔐 <b>Admin Web Dashboard Login Request</b>\n\n` +
      `Your 6-digit verification code is:\n` +
      `<code>${otpCode}</code>\n\n` +
      `<i>Valid for 10 minutes. If you did not request this, ignore this message.</i>`;

    botInstance.api.sendMessage(primaryAdminId, msg, { parse_mode: 'HTML' }).catch((err: any) => {
      logger.error({ err, primaryAdminId }, 'Failed to send Telegram 2FA OTP code');
    });
  } else {
    logger.warn({ otpCode }, 'Bot instance not bound to admin router, check console for OTP');
  }

  res.json({
    success: true,
    require2FA: true,
    adminId: primaryAdminId,
    message: 'Verification code sent to your Telegram private chat.',
  });
});

// Step 2: Verify Telegram 2FA Code -> Issues 24h Admin Session Token
adminRouter.post('/auth/verify-2fa', (req: Request, res: Response): void => {
  const { adminId, otp } = req.body;
  const targetId = Number(adminId);

  const entry = otpStore.get(targetId);
  if (!entry || entry.expiresAt < Date.now()) {
    res.status(400).json({ error: 'Verification code expired or not found. Please log in again.' });
    return;
  }

  if (entry.otp !== String(otp).trim()) {
    res.status(400).json({ error: 'Incorrect 6-digit verification code' });
    return;
  }

  // Consume OTP
  otpStore.delete(targetId);

  // Generate Session Token (24h validity)
  const token = crypto.randomBytes(32).toString('hex');
  sessionsStore.set(token, {
    token,
    adminId: targetId,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });

  res.json({
    success: true,
    token,
    admin: {
      id: targetId,
      role: 'Super Administrator',
    },
  });
});

// Admin Auth Middleware
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Admin authorization token required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const session = sessionsStore.get(token);

  if (!session || session.expiresAt < Date.now()) {
    sessionsStore.delete(token);
    res.status(401).json({ error: 'Session expired. Please log in again.' });
    return;
  }

  (req as any).adminSession = session;
  next();
}

// -------------------------------------------------------------
// Protected Dashboard Endpoints
// -------------------------------------------------------------

// 1. Overview & Analytics Metrics (Real Database Data)
adminRouter.get('/overview', requireAdminAuth, (req: Request, res: Response): void => {
  const db = getDatabase();
  const timeRange = (req.query.range as string) || '6M';
  const rail = (req.query.rail as string) || 'all';

  const railFilter = rail !== 'all' ? ' AND payment_rail = ?' : '';

  // 1. Total lifetime revenue from fulfilled orders
  const totalRevSql = `SELECT COALESCE(SUM(amount_etb), 0) as total FROM orders WHERE status = 'fulfilled'${railFilter}`;
  const totalRevenue = (rail !== 'all' ? db.prepare(totalRevSql).get(rail) : db.prepare(totalRevSql).get()) as { total: number };

  // 2. Orders status breakdown
  const ordersCountSql = `SELECT COUNT(*) as total, ` +
    `SUM(CASE WHEN status = 'fulfilled' THEN 1 ELSE 0 END) as fulfilled, ` +
    `SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) as pendingApproval, ` +
    `SUM(CASE WHEN status = 'pending_fulfillment' THEN 1 ELSE 0 END) as pendingFulfillment, ` +
    `SUM(CASE WHEN status = 'awaiting_payment' THEN 1 ELSE 0 END) as awaitingPayment ` +
    `FROM orders WHERE 1=1${railFilter}`;
  const ordersCount = (rail !== 'all' ? db.prepare(ordersCountSql).get(rail) : db.prepare(ordersCountSql).get()) as any;

  // 3. User counts
  const usersCount = db.prepare(
    "SELECT COUNT(*) as total, SUM(CASE WHEN is_registered = 1 THEN 1 ELSE 0 END) as registered FROM users"
  ).get() as any;

  // 4. Gemini Stock
  const geminiStock = getAvailableStockCount('gemini_pro_18m');

  // 5. Payment Rail Breakdown
  const railBreakdown = db.prepare(
    "SELECT payment_rail, COUNT(*) as count, SUM(amount_etb) as total_etb FROM orders WHERE status = 'fulfilled' GROUP BY payment_rail"
  ).all();

  // 6. Product Revenue Breakdown
  const productStats = [
    { id: 'gemini_pro_18m', name: 'Gemini Pro (18M)', code: 'GEMINI' },
    { id: 'telegram_premium', name: 'Telegram Premium', code: 'PREM' },
    { id: 'telegram_stars', name: 'Telegram Stars', code: 'STARS' },
  ].map((p) => {
    const pSql = `SELECT COUNT(*) as units, COALESCE(SUM(amount_etb), 0) as revenue FROM orders WHERE product_id = ? AND status = 'fulfilled'${railFilter}`;
    const row = (rail !== 'all' ? db.prepare(pSql).get(p.id, rail) : db.prepare(pSql).get(p.id)) as { units: number; revenue: number };
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

  // 7. Dynamic Timeline Chart Data based on timeRange & rail
  const chartPoints: { label: string; revenue: number; orders: number }[] = [];

  if (timeRange === '1D') {
    // Hourly for today
    for (let h = 0; h < 24; h += 3) {
      const hourStr = h.toString().padStart(2, '0');
      const hSql = `SELECT COALESCE(SUM(amount_etb), 0) as rev, COUNT(*) as count FROM orders WHERE status = 'fulfilled' AND strftime('%H', created_at) = ?${railFilter}`;
      const row = (rail !== 'all' ? db.prepare(hSql).get(hourStr, rail) : db.prepare(hSql).get(hourStr)) as any;
      chartPoints.push({
        label: `${hourStr}:00`,
        revenue: row?.rev || 0,
        orders: row?.count || 0,
      });
    }
  } else if (timeRange === '1W') {
    // Last 7 days
    for (let d = 6; d >= 0; d--) {
      const date = new Date();
      date.setDate(date.getDate() - d);
      const dateStr = date.toISOString().split('T')[0];
      const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short' });
      const dSql = `SELECT COALESCE(SUM(amount_etb), 0) as rev, COUNT(*) as count FROM orders WHERE status = 'fulfilled' AND date(created_at) = date(?)${railFilter}`;
      const row = (rail !== 'all' ? db.prepare(dSql).get(dateStr, rail) : db.prepare(dSql).get(dateStr)) as any;
      chartPoints.push({
        label: dayLabel,
        revenue: row?.rev || 0,
        orders: row?.count || 0,
      });
    }
  } else if (timeRange === '1M') {
    // 4 Weeks
    for (let w = 3; w >= 0; w--) {
      const weekLabel = `W${4 - w}`;
      const startDaysAgo = (w + 1) * 7;
      const endDaysAgo = w * 7;
      const wSql = `SELECT COALESCE(SUM(amount_etb), 0) as rev, COUNT(*) as count FROM orders WHERE status = 'fulfilled' AND created_at >= datetime('now', '-' || ? || ' days') AND created_at < datetime('now', '-' || ? || ' days')${railFilter}`;
      const row = (rail !== 'all' ? db.prepare(wSql).get(startDaysAgo, endDaysAgo, rail) : db.prepare(wSql).get(startDaysAgo, endDaysAgo)) as any;
      chartPoints.push({
        label: weekLabel,
        revenue: row?.rev || 0,
        orders: row?.count || 0,
      });
    }
  } else {
    // 6M or 1Y: Monthly buckets
    const monthsCount = timeRange === '1Y' ? 12 : 6;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    for (let i = monthsCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mIdx = d.getMonth();
      const monthLabel = months[mIdx];
      const monthFormatted = (mIdx + 1).toString().padStart(2, '0');
      const yearStr = d.getFullYear().toString();

      const mSql = `SELECT COALESCE(SUM(amount_etb), 0) as rev, COUNT(*) as count FROM orders WHERE status = 'fulfilled' AND strftime('%m', created_at) = ? AND strftime('%Y', created_at) = ?${railFilter}`;
      const row = (rail !== 'all' ? db.prepare(mSql).get(monthFormatted, yearStr, rail) : db.prepare(mSql).get(monthFormatted, yearStr)) as any;

      chartPoints.push({
        label: monthLabel,
        revenue: row?.rev || 0,
        orders: row?.count || 0,
      });
    }
  }

  // 8. Recent 5 orders
  const recSql = `SELECT id, user_id, username, product_id, amount_etb, payment_rail, status, created_at FROM orders WHERE 1=1${railFilter} ORDER BY created_at DESC LIMIT 5`;
  const recentOrders = (rail !== 'all' ? db.prepare(recSql).all(rail) : db.prepare(recSql).all()) as any[];

  res.json({
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
  });
});

// 2. Orders List & Management
adminRouter.get('/orders', requireAdminAuth, (req: Request, res: Response): void => {
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

// 3. Approve Receipt
adminRouter.post('/orders/:id/approve', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  const orderId = req.params.id as string;
  const adminId = (req as any).adminSession.adminId;

  try {
    const { order, autoDeliveredItem } = approveReceipt(orderId, adminId);

    if (botInstance) {
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

    res.json({ success: true, order, autoDeliveredItem });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Reject Receipt
adminRouter.post('/orders/:id/reject', requireAdminAuth, (req: Request, res: Response): void => {
  const orderId = req.params.id as string;
  const adminId = (req as any).adminSession.adminId;
  const { reason } = req.body;

  try {
    const order = rejectReceipt(orderId, adminId, reason || 'Payment receipt not accepted.');

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
adminRouter.post('/orders/:id/fulfill', requireAdminAuth, (req: Request, res: Response): void => {
  const orderId = req.params.id as string;
  const adminId = (req as any).adminSession.adminId;
  const { proofNote } = req.body;

  try {
    const order = fulfillOrderWithProof(orderId, adminId, { text: proofNote || 'Delivered via Fragment official rails.' });

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
adminRouter.get('/stock', requireAdminAuth, (_req: Request, res: Response): void => {
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

adminRouter.post('/stock', requireAdminAuth, (req: Request, res: Response): void => {
  const { linksText } = req.body;
  if (!linksText || typeof linksText !== 'string') {
    res.status(400).json({ error: 'Links text is required' });
    return;
  }

  const lines = linksText
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let addedCount = 0;
  for (const link of lines) {
    try {
      addStockLink('gemini_pro_18m', link);
      addedCount++;
    } catch {}
  }

  res.json({ success: true, addedCount });
});

adminRouter.delete('/stock/:id', requireAdminAuth, (req: Request, res: Response): void => {
  const itemId = req.params.id as string;
  const deleted = deleteStockItem(itemId);
  if (!deleted) {
    res.status(400).json({ error: 'Cannot delete item (may already be allocated or not found)' });
    return;
  }
  res.json({ success: true });
});

// 7. User Directory & CRM
adminRouter.get('/users', requireAdminAuth, (_req: Request, res: Response): void => {
  const users = getAllUsers();
  res.json({ users });
});

// 8. Settings Management
adminRouter.get('/settings', requireAdminAuth, (_req: Request, res: Response): void => {
  const settings = getAllSettings();
  res.json({ settings });
});

adminRouter.put('/settings', requireAdminAuth, (req: Request, res: Response): void => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    res.status(400).json({ error: 'Invalid settings object' });
    return;
  }

  for (const [key, val] of Object.entries(settings)) {
    setSetting(key, String(val));
  }

  res.json({ success: true, settings: getAllSettings() });
});

// 9. Broadcast Announcement
adminRouter.post('/broadcast', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  const { message, target } = req.body;
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'Broadcast message content is required' });
    return;
  }

  const db = getDatabase();
  let users: any[] = [];

  if (target === 'active_buyers') {
    users = db.prepare("SELECT DISTINCT user_id as id FROM orders WHERE status = 'fulfilled'").all() as any[];
  } else if (target === 'registered') {
    users = db.prepare("SELECT id FROM users WHERE is_registered = 1").all() as any[];
  } else {
    users = db.prepare("SELECT id FROM users").all() as any[];
  }

  let sentCount = 0;
  let failCount = 0;

  if (botInstance) {
    for (const u of users) {
      try {
        await botInstance.api.sendMessage(u.id, message, { parse_mode: 'HTML' });
        sentCount++;
        // Gentle throttle
        await new Promise((r) => setTimeout(r, 40));
      } catch {
        failCount++;
      }
    }
  }

  res.json({
    success: true,
    totalTargeted: users.length,
    sentCount,
    failCount,
  });
});
