import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { resetConfigCache } from '../src/config/env.js';
import { cachedSync, invalidate } from '../src/services/cache.service.js';
import { createOrder, updateOrderStatus } from '../src/services/orders.service.js';
import { addStockLink, allocateStock, deleteStockItem } from '../src/services/stock.service.js';
import { getUserStats } from '../src/services/loyalty.service.js';
import { setResellerProviderForTest } from '../src/services/reseller.service.js';
import { syncAdminsFromEnv } from '../src/auth/permissions.js';
import { seedDatabase } from '../src/db/seed.js';
import { createBot } from '../src/bot/bot.js';
import { createApiServer } from '../src/api/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');
const TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
const ADMIN_PASSWORD = 'secure-test-password-2026!';

function seedUser(db: Database.Database, id: number, username: string): void {
  db.prepare('INSERT OR IGNORE INTO users (id, username, first_name) VALUES (?, ?, ?)').run(id, username, 'Test');
}

describe('State Sharing & Cache Invalidation Concurrency', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    setResellerProviderForTest(null);
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    seedDatabase(db);
    syncAdminsFromEnv();
    invalidate(''); // Clear all cache entries
  });

  afterEach(() => {
    setResellerProviderForTest(undefined);
    closeDatabase();
    resetConfigCache();
    invalidate('');
  });

  describe('Issue 1: Admin Dashboard Overview Cache Invalidation', () => {
    it('invalidates admin overview cache when an order is created', () => {
      seedUser(db, 2001, 'bob');
      let computeCount = 0;
      const getOverview = () => cachedSync('admin:overview:24h:all', 30_000, () => {
        computeCount++;
        return { totalOrders: computeCount };
      });

      // 1. Initial fetch caches value
      const first = getOverview();
      expect(first.totalOrders).toBe(1);
      expect(computeCount).toBe(1);

      // Subsequent fetch hits cache
      const cached = getOverview();
      expect(cached.totalOrders).toBe(1);
      expect(computeCount).toBe(1);

      // 2. Create order -> should trigger invalidate('admin:overview')
      createOrder({
        userId: 2001,
        username: 'bob',
        productId: 'gemini_pro_18m',
        quantity: 1,
        amountETB: 850,
        paymentRail: 'cbe',
      });

      // 3. Fetch overview again -> must recompute immediately
      const refreshed = getOverview();
      expect(refreshed.totalOrders).toBe(2);
      expect(computeCount).toBe(2);
    });

    it('invalidates admin overview cache when an order status is updated', () => {
      seedUser(db, 2002, 'charlie');
      const order = createOrder({
        userId: 2002,
        username: 'charlie',
        productId: 'gemini_pro_18m',
        quantity: 1,
        amountETB: 850,
        paymentRail: 'cbe',
      });

      let computeCount = 0;
      const getOverview = () => cachedSync('admin:overview:7d:all', 30_000, () => {
        computeCount++;
        return { computeCount };
      });

      getOverview();
      expect(computeCount).toBe(1);

      // Transition order status
      updateOrderStatus(order.id, 'pending_approval');

      // Next call must recompute
      getOverview();
      expect(computeCount).toBe(2);
    });
  });

  describe('Issue 2: Webapp Catalog Stock Counts Invalidation', () => {
    it('invalidates catalog cache when stock is added', () => {
      let catalogBuildCount = 0;
      const getCatalog = () => cachedSync('bootstrap:catalog', 20_000, () => {
        catalogBuildCount++;
        const row = db.prepare("SELECT COUNT(*) as count FROM stock_items WHERE product_id = 'gemini_pro_18m' AND status = 'available'").get() as any;
        return { count: row.count, build: catalogBuildCount };
      });

      expect(getCatalog().build).toBe(1);
      expect(getCatalog().build).toBe(1); // Cached

      // Add stock link
      addStockLink('gemini_pro_18m', 'https://activation.test/gemini-link-1');

      // Cache must be invalidated
      const updated = getCatalog();
      expect(updated.build).toBe(2);
      expect(updated.count).toBe(1);
    });

    it('invalidates catalog cache when stock is allocated', () => {
      seedUser(db, 2003, 'dave');
      const stock = addStockLink('gemini_pro_18m', 'https://activation.test/gemini-link-2');

      let catalogBuildCount = 0;
      const getCatalog = () => cachedSync('bootstrap:catalog', 20_000, () => {
        catalogBuildCount++;
        const row = db.prepare("SELECT COUNT(*) as count FROM stock_items WHERE product_id = 'gemini_pro_18m' AND status = 'available'").get() as any;
        return { count: row.count, build: catalogBuildCount };
      });

      expect(getCatalog().count).toBe(1);
      expect(getCatalog().build).toBe(1);

      const order = createOrder({
        userId: 2003,
        username: 'dave',
        productId: 'gemini_pro_18m',
        quantity: 1,
        amountETB: 850,
        paymentRail: 'cbe',
      });

      // Allocate stock
      const result = allocateStock('gemini_pro_18m', order.id);
      expect(result.item?.id).toBe(stock.id);

      // Cache must be invalidated
      const updated = getCatalog();
      expect(updated.build).toBe(2);
      expect(updated.count).toBe(0);
    });

    it('invalidates catalog cache when stock is deleted', () => {
      const stock = addStockLink('gemini_pro_18m', 'https://activation.test/gemini-link-3');

      let catalogBuildCount = 0;
      const getCatalog = () => cachedSync('bootstrap:catalog', 20_000, () => {
        catalogBuildCount++;
        return { build: catalogBuildCount };
      });

      expect(getCatalog().build).toBe(1);

      deleteStockItem(stock.id);

      expect(getCatalog().build).toBe(2);
    });

    it('invalidates catalog cache when order with allocated stock is cancelled', () => {
      seedUser(db, 2004, 'eve');
      addStockLink('gemini_pro_18m', 'https://activation.test/gemini-link-4');

      const order = createOrder({
        userId: 2004,
        username: 'eve',
        productId: 'gemini_pro_18m',
        quantity: 1,
        amountETB: 850,
        paymentRail: 'cbe',
      });
      allocateStock('gemini_pro_18m', order.id);

      let catalogBuildCount = 0;
      const getCatalog = () => cachedSync('bootstrap:catalog', 20_000, () => {
        catalogBuildCount++;
        const row = db.prepare("SELECT COUNT(*) as count FROM stock_items WHERE product_id = 'gemini_pro_18m' AND status = 'available'").get() as any;
        return { count: row.count, build: catalogBuildCount };
      });

      expect(getCatalog().count).toBe(0);
      expect(getCatalog().build).toBe(1);

      // Cancel order -> stock restored to available and catalog invalidated
      updateOrderStatus(order.id, 'cancelled');

      const updated = getCatalog();
      expect(updated.build).toBe(2);
      expect(updated.count).toBe(1);
    });
  });

  describe('Issue 3: User Profile Loyalty Stats Cache Invalidation', () => {
    it('invalidates userstats cache when an order becomes fulfilled', () => {
      const userId = 3001;
      seedUser(db, userId, 'frank');

      const order = createOrder({
        userId,
        username: 'frank',
        productId: 'gemini_pro_18m',
        quantity: 1,
        amountETB: 850,
        paymentRail: 'cbe',
      });

      let statsQueryCount = 0;
      const getStats = () => cachedSync(`userstats:${userId}`, 5_000, () => {
        statsQueryCount++;
        const stats = getUserStats(userId);
        return { ...stats, queryCount: statsQueryCount };
      });

      const initial = getStats();
      expect(initial.orders_count).toBe(0);
      expect(initial.queryCount).toBe(1);

      // Same call returns cached
      expect(getStats().queryCount).toBe(1);

      // Transition order to fulfilled
      updateOrderStatus(order.id, 'fulfilled');

      // userstats cache must be invalidated
      const refreshed = getStats();
      expect(refreshed.queryCount).toBe(2);
      expect(refreshed.orders_count).toBe(1);
      expect(refreshed.lifetime_etb).toBe(850);
    });

    it('invalidates userstats cache when a fulfilled order is refunded', () => {
      const userId = 3002;
      seedUser(db, userId, 'grace');

      const order = createOrder({
        userId,
        username: 'grace',
        productId: 'gemini_pro_18m',
        quantity: 1,
        amountETB: 1200,
        paymentRail: 'cbe',
      });
      updateOrderStatus(order.id, 'fulfilled');

      let statsQueryCount = 0;
      const getStats = () => cachedSync(`userstats:${userId}`, 5_000, () => {
        statsQueryCount++;
        const stats = getUserStats(userId);
        return { ...stats, queryCount: statsQueryCount };
      });

      const fulfilledStats = getStats();
      expect(fulfilledStats.orders_count).toBe(1);
      expect(fulfilledStats.queryCount).toBe(1);

      // Transition to refunded
      updateOrderStatus(order.id, 'refunded');

      // userstats cache must be invalidated
      const refundedStats = getStats();
      expect(refundedStats.queryCount).toBe(2);
      expect(refundedStats.orders_count).toBe(0);
      expect(refundedStats.lifetime_etb).toBe(0);
    });
  });

  describe('HTTP Endpoint Cache Invalidation End-to-End', () => {
    let server: http.Server;
    let port: number;

    const listen = (s: http.Server): Promise<number> =>
      new Promise((resolve) => s.listen(0, () => resolve((s.address() as any).port)));

    const close = (s: http.Server): Promise<void> =>
      new Promise((resolve) => s.close(() => resolve()));

    async function login(p: number, adminId: number): Promise<string> {
      const loginRes = await fetch(`http://localhost:${p}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD, adminId }),
      });
      expect(loginRes.status).toBe(200);
      const otpRow = db.prepare('SELECT otp FROM admin_otps WHERE admin_id = ?').get(adminId) as any;
      const verifyRes = await fetch(`http://localhost:${p}/api/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId, otp: otpRow.otp }),
      });
      const data = await verifyRes.json();
      return data.token;
    }

    beforeEach(async () => {
      const bot = createBot(TOKEN);
      server = createApiServer(bot);
      port = await listen(server);
    }, 30000);

    afterEach(async () => {
      if (server) await close(server);
    });

    it('clears admin:overview and userstats when admin approves and fulfills an order via HTTP', async () => {
      const token = await login(port, 111111111);
      const userId = 4001;
      seedUser(db, userId, 'henry');

      const order = createOrder({
        userId,
        username: 'henry',
        productId: 'telegram_premium',
        quantity: 1,
        amountETB: 1800,
        paymentRail: 'cbe',
      });
      updateOrderStatus(order.id, 'pending_approval');

      // Populate caches
      let overviewCount = 0;
      const getOverview = () => cachedSync('admin:overview:24h:all', 30_000, () => {
        overviewCount++;
        return { count: overviewCount };
      });
      getOverview();
      expect(overviewCount).toBe(1);

      // Call HTTP Approve
      const approveRes = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      expect(approveRes.status).toBe(200);

      // Overview cache must be invalidated
      getOverview();
      expect(overviewCount).toBe(2);

      // Call HTTP Fulfill
      const fulfillRes = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/fulfill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ proofNote: 'Manual Fragment delivery' }),
      });
      expect(fulfillRes.status).toBe(200);

      // Overview cache must be invalidated again
      getOverview();
      expect(overviewCount).toBe(3);
    });

    it('clears catalog cache when admin adds and deletes stock via HTTP', async () => {
      const token = await login(port, 111111111);

      let catalogCount = 0;
      const getCatalog = () => cachedSync('bootstrap:catalog', 20_000, () => {
        catalogCount++;
        return { count: catalogCount };
      });
      getCatalog();
      expect(catalogCount).toBe(1);

      // Add stock via HTTP
      const addStockRes = await fetch(`http://localhost:${port}/api/admin/stock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ links: 'https://activation.test/http-stock-1\nhttps://activation.test/http-stock-2' }),
      });
      expect(addStockRes.status).toBe(200);

      // Catalog cache must be invalidated
      getCatalog();
      expect(catalogCount).toBe(2);

      // Find stock item ID
      const item = db.prepare('SELECT id FROM stock_items WHERE payload = ?').get('https://activation.test/http-stock-1') as any;

      // Delete stock via HTTP
      const delStockRes = await fetch(`http://localhost:${port}/api/admin/stock/${item.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(delStockRes.status).toBe(200);

      // Catalog cache must be invalidated
      getCatalog();
      expect(catalogCount).toBe(3);
    });
  });
});
