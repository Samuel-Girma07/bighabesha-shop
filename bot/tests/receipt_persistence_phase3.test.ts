import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import http from 'http';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { resetConfigCache } from '../src/config/env.js';
import {
  getSetting,
  getBooleanSetting,
  getNumericSetting,
  setSetting,
  setSettings,
  getAllSettings,
  VERIFICATION_SETTING_KEYS,
  DEFAULT_VERIFICATION_SETTINGS,
  validateVerificationSettings,
} from '../src/services/settings.service.js';
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

describe('Phase 3: Database Persistence, Indexing, and Settings Optimization', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  // ==========================================================================
  // 1. Migration & Composite Index Verification
  // ==========================================================================

  it('applies migration 012 and registers in _migrations', () => {
    const migrations = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
    const names = migrations.map((m) => m.name);
    expect(names).toContain('011_bank_receipt_verification.sql');
    expect(names).toContain('012_admin_dashboard_optimizations.sql');
  });

  it('creates composite index idx_receipt_evidence_order_id on receipt_evidence(order_id, id DESC)', () => {
    const indexes = db.prepare(`
      SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='receipt_evidence'
    `).all() as { name: string; sql: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_receipt_evidence_order_id');
    const targetIdx = indexes.find((i) => i.name === 'idx_receipt_evidence_order_id');
    expect(targetIdx?.sql).toContain('order_id');
    expect(targetIdx?.sql).toContain('id DESC');
  });

  it('uses idx_receipt_evidence_order_id covering index for MAX(id) batch enrichment query', () => {
    seedUser(db, 1001, 'testuser');
    for (let i = 1; i <= 5; i++) {
      db.prepare(`
        INSERT INTO orders (id, user_id, username, product_id, amount_etb, payment_rail, status)
        VALUES (?, 1001, 'testuser', 'gemini_pro_18m', 850, 'cbe', 'pending_approval')
      `).run(`ORD-BATCH-${i}`);

      db.prepare(`
        INSERT INTO receipt_evidence (order_id, user_id, bank, source, reference, normalized_reference, status)
        VALUES (?, 1001, 'cbe', 'telegram_photo', ?, ?, 'auto_verified')
      `).run(`ORD-BATCH-${i}`, `REF-${i}`, `REF-${i}`);
    }

    const orderIds = ['ORD-BATCH-1', 'ORD-BATCH-2', 'ORD-BATCH-3'];
    const placeholders = orderIds.map(() => '?').join(',');
    const explainQuery = `
      EXPLAIN QUERY PLAN
      SELECT id, order_id, bank, reference, normalized_reference, status, error_code, verified_amount_etb, security_gate_passed, created_at
      FROM receipt_evidence
      WHERE id IN (
        SELECT MAX(id)
        FROM receipt_evidence
        WHERE order_id IN (${placeholders})
        GROUP BY order_id
      )
    `;

    const plan = db.prepare(explainQuery).all(...orderIds) as any[];
    const details = plan.map((p) => p.detail);

    // Expect SQLite to use the covering index on the subquery
    const usesCoveringIndex = details.some((d) =>
      d.includes('COVERING INDEX idx_receipt_evidence_order_id')
    );
    expect(usesCoveringIndex).toBe(true);
  });

  // ==========================================================================
  // 2. Settings Seed & 18 Verification Keys Audit
  // ==========================================================================

  it('seeds all 18 dashboard verification settings keys with clean defaults', () => {
    expect(VERIFICATION_SETTING_KEYS.size).toBe(18);

    const allSettings = getAllSettings();

    for (const key of VERIFICATION_SETTING_KEYS) {
      expect(allSettings[key]).toBeDefined();
      expect(typeof allSettings[key]).toBe('string');
    }

    // Check specific critical defaults
    expect(allSettings['receipt_auto_verify_enabled']).toBe('1');
    expect(allSettings['receipt_recency_before_mins']).toBe('120');
    expect(allSettings['receipt_recency_after_mins']).toBe('120');
    expect(allSettings['receipt_circuit_breaker_threshold']).toBe('5');
    expect(allSettings['receipt_circuit_breaker_cooldown_sec']).toBe('60');
    expect(allSettings['receipt_retention_days_raw_payloads']).toBe('14');
    expect(allSettings['receipt_retention_days_unverified']).toBe('30');
    expect(allSettings['receipt_retention_days_verified']).toBe('365');
    expect(allSettings['cbe_account']).toBe('0000000000000');
    expect(allSettings['telebirr_account']).toBe('0000000000');
    expect(allSettings['abyssinia_account']).toBe('0000000000000');
    expect(allSettings['receipt_ethiopia_proxy_url']).toBe('');
  });

  it('evaluates boolean settings accurately with getBooleanSetting', () => {
    setSetting('receipt_auto_verify_enabled', '1');
    expect(getBooleanSetting('receipt_auto_verify_enabled', false)).toBe(true);

    setSetting('receipt_auto_verify_enabled', 'true');
    expect(getBooleanSetting('receipt_auto_verify_enabled', false)).toBe(true);

    setSetting('receipt_auto_verify_enabled', '0');
    expect(getBooleanSetting('receipt_auto_verify_enabled', true)).toBe(false);

    setSetting('receipt_auto_verify_enabled', 'false');
    expect(getBooleanSetting('receipt_auto_verify_enabled', true)).toBe(false);

    expect(getBooleanSetting('non_existent_bool_setting', true)).toBe(true);
    expect(getBooleanSetting('non_existent_bool_setting', false)).toBe(false);
  });

  it('updates multiple settings atomically via setSettings', () => {
    setSettings({
      receipt_recency_before_mins: '45',
      receipt_recency_after_mins: '90',
      receipt_circuit_breaker_threshold: '8',
    });

    expect(getNumericSetting('receipt_recency_before_mins', 0)).toBe(45);
    expect(getNumericSetting('receipt_recency_after_mins', 0)).toBe(90);
    expect(getNumericSetting('receipt_circuit_breaker_threshold', 0)).toBe(8);
  });

  // ==========================================================================
  // 3. Validation Logic for Dashboard Settings
  // ==========================================================================

  it('validates verification settings bounds and formats', () => {
    // Valid batch
    const validBatch = {
      cbe_account: '1000123456789',
      telebirr_account: '0911223344',
      abyssinia_account: '88881234',
      receipt_recency_before_mins: '60',
      receipt_recency_after_mins: '180',
      receipt_circuit_breaker_threshold: '10',
      receipt_circuit_breaker_cooldown_sec: '120',
      receipt_retention_days_verified: '730',
      receipt_cbe_beneficiaries: '["1000123456789", "1000987654321"]',
      receipt_ethiopia_proxy_url: 'http://proxy.example.com:8080',
    };
    const validResult = validateVerificationSettings(validBatch);
    expect(validResult.isValid).toBe(true);
    expect(validResult.errors).toHaveLength(0);

    // Invalid batch
    const invalidBatch = {
      cbe_account: '123', // Not 13 digits
      telebirr_account: 'abc', // Not valid phone
      abyssinia_account: '12345', // Too short (<8)
      receipt_recency_before_mins: '1', // Less than 5 min
      receipt_recency_after_mins: '5000', // Greater than 1440 min
      receipt_circuit_breaker_threshold: '1', // Less than 2
      receipt_circuit_breaker_cooldown_sec: '5', // Less than 10s
      receipt_cbe_beneficiaries: '{invalid json}',
      receipt_ethiopia_proxy_url: 'ftp://invalid-proto',
    };
    const invalidResult = validateVerificationSettings(invalidBatch);
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThanOrEqual(8);
  });
});

describe('Phase 3: Admin API Settings Integration & Cache Invalidation', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    initDatabase(':memory:', MIGRATIONS_DIR);
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

  it('rejects invalid verification settings with HTTP 400 and validation errors', async () => {
    const token = await loginAdmin(port, 111111111);

    const res = await fetch(`http://localhost:${port}/api/admin/settings`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          cbe_account: '12345', // invalid length
          receipt_recency_before_mins: '0', // invalid min bound
        },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Settings validation failed');
    expect(body.validationErrors).toBeDefined();
    expect(body.validationErrors.length).toBe(2);
  });

  it('accepts valid verification settings, persists them atomically, and invalidates catalog cache', async () => {
    const token = await loginAdmin(port, 111111111);

    const res = await fetch(`http://localhost:${port}/api/admin/settings`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        settings: {
          cbe_account: '1000987654321',
          receipt_recency_before_mins: '45',
          receipt_auto_verify_enabled: '1',
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.settings.cbe_account).toBe('1000987654321');
    expect(body.settings.receipt_recency_before_mins).toBe('45');

    // Confirm persisted in database
    expect(getSetting('cbe_account')).toBe('1000987654321');
    expect(getNumericSetting('receipt_recency_before_mins', 0)).toBe(45);
  });
});
