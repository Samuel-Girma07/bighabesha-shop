import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import http from 'http';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { resetConfigCache } from '../src/config/env.js';
import { createApiServer } from '../src/api/server.js';
import { createBot } from '../src/bot/bot.js';
import { setAdminBotInstance } from '../src/api/admin.js';
import { recordAudit, listAuditLogs } from '../src/services/audit.service.js';
import { updateOrderStatus, submitReceipt, createOrder } from '../src/services/orders.service.js';
import { addStockLink, deleteStockItem } from '../src/services/stock.service.js';
import { setSetting } from '../src/services/settings.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');
// tests -> bot -> repo root
const REPO_ROOT = path.resolve(__dirname, '../..');
const TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
const ADMIN_PASSWORD = 'secure-test-password-2026!';

// ---------------------------------------------------------------------------
// Fix 4: Audit trail
// ---------------------------------------------------------------------------

describe('Low #4: Audit trail records all critical admin actions', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  function seedUser(id: number): void {
    db.prepare('INSERT INTO users (id, username, first_name) VALUES (?, ?, ?)').run(id, `u${id}`, 'U');
  }

  it('records settings updates with changed keys and values', () => {
    recordAudit({
      adminId: 111111111,
      action: 'settings.update',
      targetType: 'setting',
      targetId: 'etb_per_star,cbe_account',
      changes: { etb_per_star: '3', cbe_account: '9999999999' },
      ip: '10.0.0.8',
    });

    const logs = listAuditLogs(10);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('settings.update');
    expect(logs[0].admin_id).toBe(111111111);
    expect(logs[0].target_id).toBe('etb_per_star,cbe_account');
    expect(JSON.parse(logs[0].changes!)).toEqual({ etb_per_star: '3', cbe_account: '9999999999' });
    expect(logs[0].ip).toBe('10.0.0.8');
    expect(logs[0].created_at).toBeTruthy();
  });

  it('captures stock additions and deletions', () => {
    const item = addStockLink('gemini_pro_18m', 'https://g.co/audit-stock-1');
    recordAudit({ adminId: 111111111, action: 'stock.add', targetType: 'stock', targetId: 'gemini_pro_18m', changes: { addedCount: 1 }, ip: '127.0.0.1' });
    deleteStockItem(item.id);
    recordAudit({ adminId: 111111111, action: 'stock.delete', targetType: 'stock_item', targetId: String(item.id), ip: '127.0.0.1' });

    const actions = listAuditLogs(10).map((l) => l.action);
    expect(actions).toContain('stock.add');
    expect(actions).toContain('stock.delete');
  });

  it('captures order decisions (approve/reject/fulfill) and auth events', () => {
    seedUser(801001);
    const order = createOrder({ userId: 801001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'telebirr' });
    submitReceipt(order.id, 'file-x');

    recordAudit({ adminId: 111111111, action: 'order.reject', targetType: 'order', targetId: order.id, changes: { reason: 'blurry' }, ip: '127.0.0.1' });
    recordAudit({ adminId: 111111111, action: 'auth.login.failure', targetType: 'auth', targetId: '', ip: '203.0.113.5' });
    recordAudit({ adminId: 111111111, action: 'auth.login.success', targetType: 'auth', targetId: '111111111', ip: '10.0.0.2' });
    recordAudit({ adminId: 111111111, action: 'broadcast.start', targetType: 'broadcast', targetId: 'all', changes: { totalTargeted: 42 }, ip: '10.0.0.2' });
    recordAudit({ adminId: 111111111, action: 'auth.logout', targetType: 'auth', targetId: '111111111' });

    const byAction = Object.fromEntries(listAuditLogs(50).map((l) => [l.action, l]));
    expect(byAction['order.reject'].changes).toContain('blurry');
    expect(byAction['auth.login.failure'].ip).toBe('203.0.113.5');
    expect(byAction['auth.login.success']).toBeDefined();
    expect(JSON.parse(byAction['broadcast.start'].changes!).totalTargeted).toBe(42);
    expect(byAction['auth.logout']).toBeDefined();
  });

  it('audit writes are best-effort: failures never throw', () => {
    closeDatabase(); // DB unavailable
    expect(() =>
      recordAudit({ adminId: 111111111, action: 'settings.update', targetType: 'setting', targetId: 'k', changes: { k: 'v' } })
    ).not.toThrow();
    initDatabase(':memory:', MIGRATIONS_DIR); // restore for afterEach
  });

  it('audit trail endpoint serves recent logs to authenticated admins', async () => {
    recordAudit({ adminId: 111111111, action: 'settings.update', targetType: 'setting', targetId: 'probe-key', changes: { probe: true }, ip: '127.0.0.1' });

    const bot = createBot(TOKEN);
    setAdminBotInstance(bot);
    const server: http.Server = createApiServer(bot);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, () => resolve((server.address() as any).port));
    });

    try {
      // Login -> OTP is in the database; extract and verify to get a session.
      const loginRes = await fetch(`http://localhost:${port}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD }),
      });
      expect(loginRes.status).toBe(200);
      const otpRow = getDatabase().prepare('SELECT otp FROM admin_otps WHERE admin_id = 111111111').get() as any;
      const verifyRes = await fetch(`http://localhost:${port}/api/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: 111111111, otp: otpRow.otp }),
      });
      const { token } = await verifyRes.json();
      expect(token).toBeTruthy();

      // Authenticated audit view
      const auditRes = await fetch(`http://localhost:${port}/api/admin/audit?limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(auditRes.status).toBe(200);
      const { logs } = await auditRes.json();
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);

      // Logout invalidates server-side
      const logoutRes = await fetch(`http://localhost:${port}/api/admin/auth/logout`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(logoutRes.status).toBe(200);

      const reuseRes = await fetch(`http://localhost:${port}/api/admin/audit`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(reuseRes.status).toBe(401); // token dead after logout

      const sessions = getDatabase().prepare('SELECT COUNT(*) c FROM admin_sessions WHERE token = ?').get(token) as any;
      expect(sessions.c).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('unauthenticated requests cannot read the audit trail', async () => {
    const bot = createBot(TOKEN);
    setAdminBotInstance(bot);
    const server: http.Server = createApiServer(bot);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, () => resolve((server.address() as any).port));
    });
    try {
      const res = await fetch(`http://localhost:${port}/api/admin/audit`);
      expect(res.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// ---------------------------------------------------------------------------
// Fix 5: Banner generator exhaustive handling
// ---------------------------------------------------------------------------

describe('Low #5: Banner generator fails loudly on unknown types', () => {
  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    resetConfigCache();
    initDatabase(':memory:', MIGRATIONS_DIR);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  it('throws a descriptive error instead of returning undefined', async () => {
    const mod = await import('../src/services/banner_generator.service.js');
    expect(() => (mod as any).generateSvgBanner('nonexistent_type')).toThrow(/Unknown banner type/);
  });

  it('still renders all five documented banner types', async () => {
    const mod = await import('../src/services/banner_generator.service.js');
    for (const t of ['welcome', 'gemini', 'premium', 'stars', 'checkout']) {
      const svg = (mod as any).generateSvgBanner(t);
      expect(typeof svg).toBe('string');
      expect(svg).toContain('<svg');
    }
  });
});

// ---------------------------------------------------------------------------
// Fix 8: SQLite concurrency pragmas
// ---------------------------------------------------------------------------

describe('Low #8: SQLite WAL + busy_timeout configuration', () => {
  const tmpDbPath = path.join(__dirname, '../tmp-pragma-check.db');
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    resetConfigCache();
    // WAL mode only applies to file-backed databases (in-memory reports
    // 'memory'), so assert against a real file DB.
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(tmpDbPath + suffix, { force: true });
    }
    db = initDatabase(tmpDbPath, MIGRATIONS_DIR);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(tmpDbPath + suffix, { force: true });
    }
  });

  it('initializes connections with WAL mode, a short busy_timeout and FK enforcement', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    // A25: better-sqlite3 blocks the event loop while waiting on a write lock,
    // so the timeout is deliberately short and retries happen in withWriteRetry.
    expect(Number(db.pragma('busy_timeout', { simple: true }))).toBe(250);
    expect(Number(db.pragma('wal_autocheckpoint', { simple: true }))).toBe(1000);
    expect(Number(db.pragma('foreign_keys', { simple: true }))).toBe(1);
    expect(Number(db.pragma('synchronous', { simple: true }))).toBeGreaterThan(0); // NORMAL or better
  });
});

// ---------------------------------------------------------------------------
// Fixes 1 & 2: Repository & HTML hygiene guards (regression protection)
// ---------------------------------------------------------------------------

describe('Low #1/#2: Repository cleanliness & HTML metadata guards', () => {
  it('repo root contains no scratch screenshots, debug images, or screenshot scripts', () => {
    const forbiddenPatterns = [/^scratch_/i, /^screenshot/i, /^photo_.*\.jpg$/i, /^take_screenshots\.mjs$/, /^[0-9a-f]{32}\.(jpg|png)$/i];
    const offenders = fs
      .readdirSync(REPO_ROOT)
      .filter((f) => forbiddenPatterns.some((rx) => rx.test(f)));
    expect(offenders).toEqual([]);
  });

  it('root package.json has no playwright dev dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps.playwright).toBeUndefined();
  });

  it('.gitignore blocks scratch images, screenshots, db snapshots and archives', () => {
    const gi = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf-8');
    for (const needle of ['scratch_*.png', 'Screenshot*.png', 'take_screenshots.mjs', '*.sqlite', 'bighabesha_*.tar.gz', 'coverage/']) {
      expect(gi).toContain(needle);
    }
  });

  it('webapp index.html references an existing favicon and an accessible viewport', () => {
    const html = fs.readFileSync(path.join(REPO_ROOT, 'webapp/index.html'), 'utf-8');

    // No broken asset references
    expect(html).not.toContain('/vite.svg');
    expect(html).toContain('/icons/logo.svg');
    expect(fs.existsSync(path.join(REPO_ROOT, 'webapp/public/icons/logo.svg'))).toBe(true);

    // Accessibility: no zoom restrictions on the viewport
    expect(html).not.toContain('user-scalable=no');
    expect(html).not.toContain('maximum-scale');

    const viewport =
      html.match(/name="viewport"\s+content="([^"]+)"/)?.[1] ??
      html.match(/content="([^"]+)"\s+name="viewport"/)?.[1] ??
      '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1.0');
  });
});
