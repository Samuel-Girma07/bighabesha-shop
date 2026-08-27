import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { createApiServer } from '../src/api/server.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { createOrder, submitReceipt } from '../src/services/orders.service.js';
import { saveReceiptImage } from '../src/services/receipts.service.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Admin Receipt Viewing Endpoint', () => {
  let server: http.Server;
  let port: number;
  let adminToken: string;
  const migrationsDir = path.join(__dirname, '../src/db/migrations');

  beforeEach(async () => {
    process.env.ADMIN_IDS = '12345';
    process.env.ADMIN_PASSWORD = 'TestPassword123!';
    process.env.BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';

    initDatabase(':memory:', migrationsDir);
    const db = getDatabase();

    // Setup admin user & session
    db.prepare('INSERT OR IGNORE INTO users (id, first_name, username, is_registered) VALUES (?, ?, ?, 1)').run(12345, 'Admin', 'admin_boss');
    db.prepare('INSERT OR REPLACE INTO admins (tg_user_id, role, is_active, created_by) VALUES (?, ?, 1, ?)').run(12345, 'superadmin', 'test');

    adminToken = 'test_admin_token_abcdef1234567890abcdef1234567890abcdef12345678901234';
    db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run(
      adminToken,
      12345,
      Date.now() + 3600000
    );

    const mockBot = {
      api: {
        getFile: async (fileId: string) => {
          if (fileId === 'mock_tg_file_id') {
            return { file_id: 'mock_tg_file_id', file_path: 'photos/mock_receipt.jpg' };
          }
          throw new Error('Telegram file not found');
        },
        sendMessage: async () => ({}),
      },
    } as any;

    server = createApiServer(mockBot);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as any;
        port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
  });

  it('serves disk-stored receipt image with ?token= parameter', async () => {
    const order = createOrder({
      userId: 99999,
      productId: 'gemini_pro_18m',
      amountETB: 500,
      paymentRail: 'cbe',
      quantity: 1,
    });

    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const saved = await saveReceiptImage(sampleBase64, order.id);
    submitReceipt(order.id, saved.storedName, 'Paid via CBE mobile banking');

    // Query-string tokens are forbidden (log/history leakage) — Bearer only.
    const res = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/receipt`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
  });

  it('rejects unauthorized requests without a Bearer token', async () => {
    const order = createOrder({
      userId: 99999,
      productId: 'gemini_pro_18m',
      amountETB: 500,
      paymentRail: 'cbe',
      quantity: 1,
    });

    const res = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/receipt`);
    expect(res.status).toBe(401);
  });
});
