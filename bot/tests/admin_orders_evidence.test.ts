import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { resetConfigCache } from '../src/config/env.js';
import { createApiServer } from '../src/api/server.js';
import { createBot } from '../src/bot/bot.js';
import { syncAdminsFromEnv } from '../src/auth/permissions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');
const TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
const ADMIN_PASSWORD = 'secure-test-password-2026!';

function seedUser(db: Database.Database, id: number, username: string): void {
  db.prepare('INSERT OR IGNORE INTO users (id, username, first_name) VALUES (?, ?, ?)').run(id, username, 'Test');
}

async function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, () => resolve((server.address() as any).port)));
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function loginAdmin(port: number, adminId: number): Promise<string> {
  const loginRes = await fetch(`http://localhost:${port}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD, adminId }),
  });
  expect(loginRes.status).toBe(200);
  const otpRow = getDatabase().prepare('SELECT otp FROM admin_otps WHERE admin_id = ?').get(adminId) as any;
  const verifyRes = await fetch(`http://localhost:${port}/api/admin/auth/verify-2fa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminId, otp: otpRow.otp }),
  });
  const data = await verifyRes.json();
  return data.token;
}

describe('Admin Orders API Evidence Enrichment', () => {
  let db: Database.Database;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    syncAdminsFromEnv();

    const bot = createBot(TOKEN);
    server = createApiServer(bot);
    port = await listen(server);
  });

  afterEach(async () => {
    await closeServer(server);
    closeDatabase();
    resetConfigCache();
  });

  it('enriches orders with latest receipt evidence and handles orders without evidence', async () => {
    const token = await loginAdmin(port, 111111111);

    // Seed test users
    seedUser(db, 1001, 'alice');
    seedUser(db, 1002, 'bob');

    // Create 2 orders: ORD-1 with evidence, ORD-2 without evidence
    db.prepare(`
      INSERT INTO orders (id, user_id, username, product_id, amount_etb, payment_rail, status)
      VALUES ('ORD-TEST-1', 1001, 'alice', 'gemini_pro_18m', 850, 'cbe', 'pending_approval')
    `).run();

    db.prepare(`
      INSERT INTO orders (id, user_id, username, product_id, amount_etb, payment_rail, status)
      VALUES ('ORD-TEST-2', 1002, 'bob', 'telegram_premium', 1800, 'manual', 'awaiting_payment')
    `).run();

    // Insert 2 evidence records for ORD-1 (an older failed one and a newer auto_verified one)
    db.prepare(`
      INSERT INTO receipt_evidence (id, order_id, user_id, bank, source, reference, normalized_reference, status, error_code, verified_amount_etb, security_gate_passed, created_at)
      VALUES (10, 'ORD-TEST-1', 1001, 'cbe', 'telegram_photo', 'OLD_REF', 'OLD_REF', 'upstream_failure', 'BANK_PORTAL_UNAVAILABLE', NULL, 0, '2026-09-08 10:00:00')
    `).run();

    db.prepare(`
      INSERT INTO receipt_evidence (id, order_id, user_id, bank, source, reference, normalized_reference, status, error_code, verified_amount_etb, security_gate_passed, created_at)
      VALUES (11, 'ORD-TEST-1', 1001, 'cbe', 'telegram_photo', 'FT2609081234', 'FT2609081234', 'auto_verified', NULL, 850, 1, '2026-09-08 10:05:00')
    `).run();

    const res = await fetch(`http://localhost:${port}/api/admin/orders`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.orders).toBeDefined();
    expect(body.orders.length).toBe(2);

    const order1 = body.orders.find((o: any) => o.id === 'ORD-TEST-1');
    const order2 = body.orders.find((o: any) => o.id === 'ORD-TEST-2');

    expect(order1).toBeDefined();
    expect(order1.evidence).toBeDefined();
    expect(order1.evidence).toEqual({
      id: 11, // Latest record (MAX id)
      bank: 'cbe',
      reference: 'FT2609081234',
      normalized_reference: 'FT2609081234',
      status: 'auto_verified',
      error_code: null,
      verified_amount_etb: 850,
      security_gate_passed: true,
      created_at: '2026-09-08 10:05:00',
    });

    expect(order2).toBeDefined();
    expect(order2.evidence).toBeNull();
  });
});
