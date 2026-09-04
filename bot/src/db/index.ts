import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger/index.js';
import { resolveDatabasePath } from '../config/env.js';
import { runMigrations } from './migrator.js';
import { seedDatabase } from './seed.js';

let dbInstance: Database.Database | null = null;

const stmtCache = new Map<string, Database.Statement>();

export function initDatabase(dbPath?: string, migrationsDir?: string): Database.Database {
  const resolvedPath = resolveDatabasePath(dbPath);
  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  logger.info({ dbPath: resolvedPath }, 'Initializing SQLite database...');
  const db = new Database(resolvedPath);

  // Performance and safety pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Deliberately short: better-sqlite3 blocks the event loop while waiting on a
  // write lock, so contention is absorbed by withWriteRetry() instead.
  db.pragma('busy_timeout = 250');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('mmap_size = 268435456');
  db.pragma('wal_autocheckpoint = 1000');

  runMigrations(db, migrationsDir);
  seedDatabase(db);

  stmtCache.clear();
  dbInstance = db;
  return db;
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    throw new Error('Database has not been initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

export function prepared(sql: string): Database.Statement {
  const hit = stmtCache.get(sql);
  if (hit) return hit;
  const stmt = getDatabase().prepare(sql);
  stmtCache.set(sql, stmt);
  return stmt;
}

export async function withWriteRetry<T>(fn: () => T, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (err: any) {
      const code = err?.code as string | undefined;
      if (code !== 'SQLITE_BUSY' && code !== 'SQLITE_BUSY_SNAPSHOT') throw err;
      lastErr = err;
      const backoffMs = Math.random() * Math.min(500, 25 * 2 ** i);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  logger.error({ err: lastErr, attempts }, 'Write abandoned after SQLITE_BUSY retries');
  throw lastErr;
}



export function closeDatabase(): void {
  if (dbInstance) {
    stmtCache.clear();
    dbInstance.close();
    dbInstance = null;
  }
}
