import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';

export interface Product {
  id: string;
  type: 'stock' | 'order';
  name: string;
  description: string;
  is_active: number;
  meta: string;
  created_at: string;
  updated_at: string;
}

export interface Variant {
  id: string;
  product_id: string;
  name: string;
  price_etb: number;
  is_active: number;
  sort_order: number;
  meta: string;
  created_at: string;
  updated_at: string;
}

export function formatPriceETB(amount: number): string {
  return `${amount.toLocaleString('en-US')} ETB`;
}

export function getAllProducts(includeInactive: boolean = false): Product[] {
  try {
    const db = getDatabase();
    const query = includeInactive
      ? 'SELECT * FROM products ORDER BY rowid ASC'
      : 'SELECT * FROM products WHERE is_active = 1 ORDER BY rowid ASC';
    return db.prepare(query).all() as Product[];
  } catch (err) {
    logger.error({ err }, 'Failed to get products');
    return [];
  }
}

export function getProductById(id: string): Product | undefined {
  try {
    const db = getDatabase();
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined;
  } catch (err) {
    logger.error({ err, id }, 'Failed to get product by id');
    return undefined;
  }
}

export function getProductVariants(productId: string, includeInactive: boolean = false): Variant[] {
  try {
    const db = getDatabase();
    const query = includeInactive
      ? 'SELECT * FROM variants WHERE product_id = ? ORDER BY sort_order ASC, price_etb ASC'
      : 'SELECT * FROM variants WHERE product_id = ? AND is_active = 1 ORDER BY sort_order ASC, price_etb ASC';
    return db.prepare(query).all(productId) as Variant[];
  } catch (err) {
    logger.error({ err, productId }, 'Failed to get variants for product');
    return [];
  }
}

export function getVariantById(variantId: string): Variant | undefined {
  try {
    const db = getDatabase();
    return db.prepare('SELECT * FROM variants WHERE id = ?').get(variantId) as Variant | undefined;
  } catch (err) {
    logger.error({ err, variantId }, 'Failed to get variant by id');
    return undefined;
  }
}

export function updateVariantPrice(variantId: string, newPriceETB: number): void {
  if (newPriceETB < 0 || !Number.isInteger(newPriceETB)) {
    throw new Error('Price must be a non-negative integer.');
  }

  const db = getDatabase();
  const res = db.prepare(`
    UPDATE variants
    SET price_etb = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(newPriceETB, variantId);

  if (res.changes === 0) {
    throw new Error(`Variant with ID "${variantId}" not found.`);
  }

  logger.info({ variantId, newPriceETB }, 'Variant price updated');
}

export function setProductActive(productId: string, isActive: boolean): void {
  const db = getDatabase();
  const res = db.prepare(`
    UPDATE products
    SET is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(isActive ? 1 : 0, productId);

  if (res.changes === 0) {
    throw new Error(`Product with ID "${productId}" not found.`);
  }

  logger.info({ productId, isActive }, 'Product active status updated');
}
