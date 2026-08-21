import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger/index.js';
import { runMigrations } from './migrator.js';
import { seedDatabase } from './seed.js';

let dbInstance: Database.Database | null = null;

export function initDatabase(dbPath: string = './data/shop.db', migrationsDir?: string): Database.Database {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  logger.info({ dbPath }, 'Initializing SQLite database...');
  const db = new Database(dbPath);

  // Performance and safety pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  runMigrations(db, migrationsDir);
  seedDatabase(db);

  dbInstance = db;
  return db;
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    throw new Error('Database has not been initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
