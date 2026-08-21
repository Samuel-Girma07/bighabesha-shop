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
  });
});
