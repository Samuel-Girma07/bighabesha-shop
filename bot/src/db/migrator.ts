import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runMigrations(db: Database.Database, migrationsDir?: string): number {
  const dir = migrationsDir || path.join(__dirname, 'migrations');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  if (!fs.existsSync(dir)) {
    logger.warn({ dir }, 'Migrations directory not found, skipping disk migrations.');
    return 0;
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let appliedCount = 0;

  for (const file of files) {
    const isApplied = db.prepare('SELECT id FROM _migrations WHERE name = ?').get(file);
    if (!isApplied) {
      const filePath = path.join(dir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      logger.info({ file }, `Applying database migration: ${file}`);
      const applyTx = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      });
      applyTx();
      appliedCount++;
    }
  }

  return appliedCount;
}
