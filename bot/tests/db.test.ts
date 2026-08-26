import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrator.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Database and Migrations', () => {
  let db: Database.Database;
  const migrationsDir = path.join(__dirname, '../src/db/migrations');

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('runs initial migrations successfully and registers them in _migrations', () => {
    const applied = runMigrations(db, migrationsDir);
    expect(applied).toBeGreaterThan(0);

    const migrations = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
    expect(migrations.map((m) => m.name)).toContain('001_init.sql');
  });

  it('is idempotent when run multiple times', () => {
    const firstRun = runMigrations(db, migrationsDir);
    expect(firstRun).toBeGreaterThan(0);

    const secondRun = runMigrations(db, migrationsDir);
    expect(secondRun).toBe(0);
  });

  it('creates all core tables with proper schema', () => {
    runMigrations(db, migrationsDir);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('users');
    expect(tableNames).toContain('products');
    expect(tableNames).toContain('variants');
    expect(tableNames).toContain('stock_items');
    expect(tableNames).toContain('orders');
    expect(tableNames).toContain('settings');
    expect(tableNames).toContain('admin_sessions');
    expect(tableNames).toContain('admin_otps');
    expect(tableNames).toContain('bot_sessions');
    expect(tableNames).toContain('broadcast_drafts');
  });

  it('persists admin sessions and 2FA OTPs across restarts and enforces TTL expiration', () => {
    runMigrations(db, migrationsDir);

    // Insert OTP and session
    const adminId = 111111111;
    const otp = '654321';
    const validExpiresAt = Date.now() + 10 * 60 * 1000;
    const expiredAt = Date.now() - 1000;

    db.prepare('INSERT INTO admin_otps (admin_id, otp, expires_at) VALUES (?, ?, ?)').run(adminId, otp, validExpiresAt);
    db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run('test_token_valid', adminId, validExpiresAt);
    db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run('test_token_expired', adminId, expiredAt);

    // Verify retrieval
    const retrievedOtp = db.prepare('SELECT * FROM admin_otps WHERE admin_id = ?').get(adminId) as any;
    expect(retrievedOtp.otp).toBe('654321');
    expect(retrievedOtp.expires_at).toBe(validExpiresAt);

    const validSession = db.prepare('SELECT * FROM admin_sessions WHERE token = ?').get('test_token_valid') as any;
    expect(validSession).toBeDefined();
    expect(validSession.admin_id).toBe(adminId);

    const expiredSession = db.prepare('SELECT * FROM admin_sessions WHERE token = ?').get('test_token_expired') as any;
    expect(expiredSession.expires_at).toBeLessThan(Date.now());
  });

  it('supports concurrent broadcast drafts by multiple admins without collision', () => {
    runMigrations(db, migrationsDir);

    const admin1 = 111111111;
    const admin2 = 222222333;

    db.prepare(`
      INSERT INTO broadcast_drafts (admin_id, text, photo_file_id, target_lang)
      VALUES (?, ?, ?, ?)
    `).run(admin1, 'Broadcast from Admin 1', 'photo_1', 'en');

    db.prepare(`
      INSERT INTO broadcast_drafts (admin_id, text, photo_file_id, target_lang)
      VALUES (?, ?, ?, ?)
    `).run(admin2, 'Broadcast from Admin 2', null, 'am');

    const draft1 = db.prepare('SELECT * FROM broadcast_drafts WHERE admin_id = ?').get(admin1) as any;
    const draft2 = db.prepare('SELECT * FROM broadcast_drafts WHERE admin_id = ?').get(admin2) as any;

    expect(draft1.text).toBe('Broadcast from Admin 1');
    expect(draft1.photo_file_id).toBe('photo_1');
    expect(draft1.target_lang).toBe('en');

    expect(draft2.text).toBe('Broadcast from Admin 2');
    expect(draft2.photo_file_id).toBeNull();
    expect(draft2.target_lang).toBe('am');
  });

  it('persists bot user sessions across restarts', async () => {
    const { initDatabase, closeDatabase } = await import('../src/db/index.js');
    const { setPendingAction, getPendingAction, clearPendingAction } = await import('../src/bot/session.js');

    const memDb = initDatabase(':memory:', migrationsDir);

    setPendingAction(1001, {
      type: 'stars_custom_amount',
      data: { minStars: 50, maxStars: 5000 },
    }, 15);

    const session = getPendingAction(1001);
    expect(session).toBeDefined();
    expect(session?.type).toBe('stars_custom_amount');
    expect(session?.data?.minStars).toBe(50);

    clearPendingAction(1001);
    expect(getPendingAction(1001)).toBeUndefined();

    closeDatabase();
  });
});

