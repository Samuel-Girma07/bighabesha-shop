import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { getConfig, resolveDatabasePath, resolveRepoRoot } from '../config/env.js';
import { logger } from '../logger/index.js';
import { uploadReceiptToRemote } from './storage.service.js';

export class ReceiptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptValidationError';
  }
}

/** Recognized receipt image formats and their magic bytes. */
const IMAGE_SIGNATURES: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'jpg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    ext: 'webp',
    test: (b) =>
      b.length >= 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
];

export function detectImageExtension(buffer: Buffer): string | null {
  for (const sig of IMAGE_SIGNATURES) {
    if (sig.test(buffer)) return sig.ext;
  }
  return null;
}

/**
 * Resolves the receipt storage directory: explicit RECEIPTS_DIR override,
 * otherwise alongside the SQLite database file (NOT process.cwd(), which
 * depends on how PM2/the shell was launched).
 */
export function resolveReceiptsDir(databasePath?: string): string {
  const config = getConfig();
  if (databasePath) {
    const resolvedDb = resolveDatabasePath(databasePath);
    if (resolvedDb === ':memory:') {
      return config.RECEIPTS_DIR ? path.resolve(config.RECEIPTS_DIR) : path.resolve(resolveRepoRoot(), 'data/receipts');
    }
    return path.join(path.dirname(resolvedDb), 'receipts');
  }
  if (config.RECEIPTS_DIR) {
    return path.resolve(config.RECEIPTS_DIR);
  }
  if (config.DATA_DIR) {
    return path.resolve(config.DATA_DIR, 'receipts');
  }
  const dbPath = resolveDatabasePath(config.DATABASE_PATH);
  if (dbPath === ':memory:') {
    return path.resolve(resolveRepoRoot(), 'data/receipts');
  }
  return path.join(path.dirname(dbPath), 'receipts');
}

export interface SavedReceipt {
  filePath: string;
  /** Filename-only identifier safe to persist as order.receipt_file_id. */
  storedName: string;
  extension: string;
  bytes: number;
}

/**
 * Resolves a persisted receipt_file_id to an absolute path INSIDE the
 * receipts directory, or null when the reference escapes the directory,
 * is empty, or no longer exists on disk.
 */
export function resolveStoredReceiptPath(fileId: unknown): string | null {
  if (typeof fileId !== 'string' || fileId.length === 0) return null;

  const dir = path.resolve(resolveReceiptsDir());
  const resolved = path.resolve(dir, fileId);
  const rel = path.relative(dir, resolved);

  // Empty rel => resolved IS the dir itself; '..' or absolute rel =>
  // resolved escaped the receipts root. Reject both.
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;

  return fs.existsSync(resolved) ? resolved : null;
}

/**
 * Decodes a base64 receipt image, validates format via magic bytes, enforces
 * the configured size cap, and writes it to the receipts directory with a
 * truthful extension derived from the detected content type.
 */
export async function saveReceiptImage(
  base64Data: string,
  orderId: string,
  options: { nowMs?: number } = {}
): Promise<SavedReceipt> {
  const config = getConfig();
  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');

  if (buffer.length === 0) {
    throw new ReceiptValidationError('Decoded receipt image is empty.');
  }

  const maxBytes = config.RECEIPT_MAX_BYTES;
  if (buffer.length > maxBytes) {
    throw new ReceiptValidationError(
      `Receipt image is too large (${(buffer.length / 1024 / 1024).toFixed(2)} MB). Maximum is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`
    );
  }

  const ext = detectImageExtension(buffer);
  if (!ext) {
    throw new ReceiptValidationError(
      'Unsupported receipt format. Please upload a JPEG, PNG, or WebP image.'
    );
  }

  const dir = resolveReceiptsDir();
  await fsp.mkdir(dir, { recursive: true });

  const safeOrderId = orderId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `receipt_${safeOrderId}_${options.nowMs ?? Date.now()}.${ext}`;
  const filePath = path.join(dir, filename);
  await fsp.writeFile(filePath, buffer);

  // Asynchronously replicate to Backblaze B2 / S3 if configured
  void uploadReceiptToRemote(filename, buffer, `image/${ext}`).catch((err) => {
    logger.warn({ err, filename }, 'Non-blocking upload of receipt to remote storage failed');
  });

  logger.info(
    { orderId, bytes: buffer.length, ext, dir },
    'Receipt image saved'
  );

  return { filePath, storedName: filename, extension: ext, bytes: buffer.length };
}

/**
 * Deletes receipt files older than the retention window. Returns the number
 * of files removed. Missing directories are treated as "nothing to purge".
 */
export async function purgeOldReceipts(retentionDays?: number, nowMs: number = Date.now()): Promise<number> {
  const config = getConfig();
  const days = retentionDays ?? config.RECEIPT_RETENTION_DAYS;
  if (days === 0) return 0;
  const dir = resolveReceiptsDir();

  try {
    await fsp.access(dir);
  } catch {
    return 0;
  }

  const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
  let removed = 0;

  try {
    const entries = await fsp.readdir(dir);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.startsWith('receipt_')) continue;
      const full = path.join(dir, entry);
      try {
        const stat = await fsp.stat(full);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          await fsp.unlink(full);
          removed++;
        }
      } catch (err) {
        logger.warn({ err, full }, 'Failed to purge receipt file');
      }
      if (i % 50 === 49) await new Promise((resolve) => setImmediate(resolve));
    }
  } catch (err) {
    logger.warn({ err, dir }, 'Receipt purge could not read directory');
  }

  if (removed > 0) {
    logger.info({ removed, retentionDays: days }, 'Purged expired receipt uploads');
  }
  return removed;
}
