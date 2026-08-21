import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';
import { getNumericSetting } from './settings.service.js';

export interface StockItem {
  id: number;
  product_id: string;
  payload: string;
  status: 'available' | 'allocated' | 'invalid';
  order_id: string | null;
  created_at: string;
  allocated_at: string | null;
}

export interface CSVImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export function addStockLink(productId: string, rawLink: string): StockItem {
  const link = rawLink.trim();
  if (!link) {
    throw new Error('Stock link/payload cannot be empty.');
  }

  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO stock_items (product_id, payload, status)
    VALUES (?, ?, 'available')
  `);

  const result = stmt.run(productId, link);
  const item = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(result.lastInsertRowid) as StockItem;
  logger.info({ productId, itemId: item.id }, 'Single stock item added');
  return item;
}

export function deleteStockItem(id: number | string): boolean {
  try {
    const db = getDatabase();
    const result = db.prepare("DELETE FROM stock_items WHERE id = ? AND status = 'available'").run(id);
    return result.changes > 0;
  } catch (err) {
    logger.error({ err, id }, 'Failed to delete stock item');
    return false;
  }
}

export function importStockCSV(productId: string, csvContent: string): CSVImportResult {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const result: CSVImportResult = {
    imported: 0,
    skipped: 0,
    errors: [],
  };

  if (lines.length === 0) {
    return result;
  }

  const db = getDatabase();
  const insertStmt = db.prepare(`
    INSERT INTO stock_items (product_id, payload, status)
    VALUES (?, ?, 'available')
  `);

  const insertTx = db.transaction((linksToInsert: string[]) => {
    for (const link of linksToInsert) {
      insertStmt.run(productId, link);
      result.imported++;
    }
  });

  const validLinks: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    // Check if line is a header like 'link', 'url', 'payload', 'activation_link'
    if (i === 0 && /^(link|url|payload|activation_link|code)$/i.test(rawLine)) {
      result.skipped++;
      continue;
    }

    // Split if line has comma-separated fields
    const columns = rawLine.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
    const linkCandidate = columns.find((c) => c.length > 0);

    if (!linkCandidate) {
      result.skipped++;
      continue;
    }

    // Basic validity check (must have content)
    if (linkCandidate.length < 3) {
      result.errors.push(`Row ${i + 1}: Content too short ("${rawLine}")`);
      result.skipped++;
      continue;
    }

    validLinks.push(linkCandidate);
  }

  if (validLinks.length > 0) {
    insertTx(validLinks);
    logger.info({ productId, importedCount: result.imported }, 'CSV stock import completed');
  }

  return result;
}

export function getAvailableStockCount(productId: string): number {
  try {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT COUNT(*) as count
      FROM stock_items
      WHERE product_id = ? AND status = 'available'
    `).get(productId) as { count: number };
    return row ? row.count : 0;
  } catch (err) {
    logger.error({ err, productId }, 'Failed to count available stock');
    return 0;
  }
}

export function getTotalStockCount(productId: string): { available: number; allocated: number; total: number } {
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM stock_items
      WHERE product_id = ?
      GROUP BY status
    `).all(productId) as { status: string; count: number }[];

    let available = 0;
    let allocated = 0;

    for (const r of rows) {
      if (r.status === 'available') available = r.count;
      if (r.status === 'allocated') allocated = r.count;
    }

    return {
      available,
      allocated,
      total: available + allocated,
    };
  } catch (err) {
    logger.error({ err, productId }, 'Failed to fetch stock counts');
    return { available: 0, allocated: 0, total: 0 };
  }
}

export function allocateStock(
  productId: string,
  orderId: string
): { item: StockItem | null; remaining: number; shouldAlertLowStock: boolean } {
  const db = getDatabase();

  let allocatedItem: StockItem | null = null;
  let remainingCount = 0;

  const tx = db.transaction(() => {
    // Select one available item
    const item = db.prepare(`
      SELECT * FROM stock_items
      WHERE product_id = ? AND status = 'available'
      LIMIT 1
    `).get(productId) as StockItem | undefined;

    if (!item) {
      return;
    }

    // Atomically mark it allocated
    db.prepare(`
      UPDATE stock_items
      SET status = 'allocated', order_id = ?, allocated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(orderId, item.id);

    allocatedItem = { ...item, status: 'allocated', order_id: orderId, allocated_at: new Date().toISOString() };

    const countRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM stock_items
      WHERE product_id = ? AND status = 'available'
    `).get(productId) as { count: number };

    remainingCount = countRow ? countRow.count : 0;
  });

  tx();

  const threshold = getNumericSetting('low_stock_threshold', 5);
  const shouldAlertLowStock = remainingCount <= threshold;

  return {
    item: allocatedItem,
    remaining: remainingCount,
    shouldAlertLowStock,
  };
}
