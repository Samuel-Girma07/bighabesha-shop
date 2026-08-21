import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { validateTelegramInitData } from '../src/api/auth.js';
import { createApiServer } from '../src/api/server.js';
import { createBot } from '../src/bot/bot.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateValidInitData(userObj: any, token: string, authDate = Math.floor(Date.now() / 1000)): string {
  const userJson = JSON.stringify(userObj);
  const params: Record<string, string> = {
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohD_abcdef',
    user: userJson,
  };

  const items = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  const dataCheckString = items.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    searchParams.set(k, v);
  }
  searchParams.set('hash', hash);

  return searchParams.toString();
}

describe('Phase 5: Telegram Mini App & Authenticated API', () => {
  const token = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
  let db: Database.Database;
  const migrationsDir = path.join(__dirname, '../src/db/migrations');
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    process.env.BOT_TOKEN = token;
    process.env.ADMIN_IDS = '1397163638';
    db = initDatabase(':memory:', migrationsDir);

    const bot = createBot(token);
    server = createApiServer(bot);

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

  describe('Telegram initData HMAC Authentication', () => {
    it('successfully validates authentic Telegram initData and returns parsed user', () => {
      const user = { id: 123456, first_name: 'Abebe', username: 'abebe_eth', language_code: 'en' };
      const initData = generateValidInitData(user, token);

      const result = validateTelegramInitData(initData, token);
      expect(result).toBeDefined();
      expect(result?.user.id).toBe(123456);
      expect(result?.user.username).toBe('abebe_eth');
    });

    it('rejects tampered initData where user details have been modified', () => {
      const user = { id: 123456, first_name: 'Abebe', username: 'abebe_eth' };
      const validInitData = generateValidInitData(user, token);

      // Tamper with user payload without re-signing
      const tampered = validInitData.replace('abebe_eth', 'hacked_username');

      const result = validateTelegramInitData(tampered, token);
      expect(result).toBeNull();
    });

    it('rejects initData signed with wrong bot token', () => {
      const user = { id: 123456, first_name: 'Abebe' };
      const initData = generateValidInitData(user, 'DIFFERENT_BOT_TOKEN');

      const result = validateTelegramInitData(initData, token);
      expect(result).toBeNull();
    });

    it('rejects empty or missing parameters', () => {
      expect(validateTelegramInitData('', token)).toBeNull();
      expect(validateTelegramInitData('random_query_without_hash=123', token)).toBeNull();
    });
  });

  describe('REST API Contracts', () => {
    it('returns status ok on GET /api/health', async () => {
      const res = await fetch(`http://localhost:${port}/api/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
    });

    it('returns catalog bootstrap data without requiring auth', async () => {
      const res = await fetch(`http://localhost:${port}/api/bootstrap`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.products).toHaveLength(3);
      expect(data.settings.etb_per_usd).toBe('135');
    });

    it('rejects unauthorized access on /api/orders without initData', async () => {
      const res = await fetch(`http://localhost:${port}/api/orders`);
      expect(res.status).toBe(401);
    });

    it('allows authorized users with valid initData to create orders and view history', async () => {
      const user = { id: 777777, first_name: 'Buyer', username: 'habeshabuyer' };
      const authInitData = generateValidInitData(user, token);

      // Create order
      const createRes = await fetch(`http://localhost:${port}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${authInitData}`,
        },
        body: JSON.stringify({
          productId: 'gemini_pro_18m',
          amountETB: 1500,
          paymentRail: 'cbe',
        }),
      });

      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      expect(created.order.id).toMatch(/^ORD-/);
      expect(created.order.user_id).toBe(777777);

      // View orders
      const listRes = await fetch(`http://localhost:${port}/api/orders`, {
        headers: {
          Authorization: `tma ${authInitData}`,
        },
      });

      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(listData.orders.length).toBeGreaterThan(0);
      expect(listData.orders[0].id).toBe(created.order.id);
    });

    it('enforces Username Gate in API when purchasing Telegram Premium without a username', async () => {
      const userWithoutUsername = { id: 888888, first_name: 'NoUser' }; // no username
      const authInitData = generateValidInitData(userWithoutUsername, token);

      const res = await fetch(`http://localhost:${port}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${authInitData}`,
        },
        body: JSON.stringify({
          productId: 'telegram_premium',
          variantId: 'tg_prem_3m',
          amountETB: 1100,
          paymentRail: 'cbe',
        }),
      });

      expect(res.status).toBe(403);
      const errorData = await res.json();
      expect(errorData.error).toBe('USERNAME_REQUIRED');
    });
  });
});
