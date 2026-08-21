import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createBot } from '../src/bot/bot.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { upsertUser } from '../src/bot/handlers/start.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Bot Core & Handlers', () => {
  beforeEach(() => {
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = '111111,222222';
    const migrationsDir = path.join(__dirname, '../src/db/migrations');
    initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('creates a bot instance successfully with valid token', () => {
    const bot = createBot('123456789:ABCdefGHIjklMNOpqrSTUvwxYZ');
    expect(bot).toBeDefined();
    expect(bot.token).toBe('123456789:ABCdefGHIjklMNOpqrSTUvwxYZ');
  });

  it('upserts regular users and assigns non-admin status', () => {
    const res = upsertUser({
      id: 999999,
      username: 'habeshatester',
      first_name: 'Habesha',
      last_name: 'Buyer',
      language_code: 'en',
    });

    expect(res.is_admin).toBe(false);
    expect(res.language_code).toBe('en');

    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(999999) as any;
    expect(user).toBeDefined();
    expect(user.username).toBe('habeshatester');
    expect(user.is_admin).toBe(0);
  });

  it('detects admin users and assigns is_admin = 1', () => {
    const res = upsertUser({
      id: 111111,
      username: 'superadmin',
      first_name: 'Admin',
      language_code: 'en',
    });

    expect(res.is_admin).toBe(true);

    const db = getDatabase();
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(111111) as any;
    expect(user.is_admin).toBe(1);
  });
});
