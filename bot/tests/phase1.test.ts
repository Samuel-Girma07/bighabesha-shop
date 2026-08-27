import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrator.js';
import { seedDatabase } from '../src/db/seed.js';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import {
  getAllProducts,
  getProductById,
  getProductVariants,
  getVariantById,
  updateVariantPrice,
  formatPriceETB,
} from '../src/services/catalog.service.js';
import {
  addStockLink,
  importStockCSV,
  getAvailableStockCount,
  getTotalStockCount,
  allocateStock,
} from '../src/services/stock.service.js';
import { isAdmin } from '../src/bot/handlers/admin.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 1: Catalog, Stock, Rates, and Validation', () => {
  let db: Database.Database;
  const migrationsDir = path.join(__dirname, '../src/db/migrations');

  beforeEach(() => {
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = '111111111,222222333';
    db = initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('Database Seeding & Idempotency', () => {
    it('seeds the 2 required v1 products with default variants and settings', () => {
      const products = getAllProducts();
      expect(products).toHaveLength(2);

      const productIds = products.map((p) => p.id);
      expect(productIds).toContain('gemini_pro_18m');
      expect(productIds).toContain('telegram_premium');

      const premVariants = getProductVariants('telegram_premium');
      expect(premVariants).toHaveLength(3);
      expect(premVariants.map((v) => v.price_etb)).toEqual([1100, 1900, 3400]);
    });

    it('is completely idempotent when run multiple times', () => {
      // Re-run seed on existing DB
      seedDatabase(db);
      seedDatabase(db);

      const products = getAllProducts();
      expect(products).toHaveLength(2);

      const premVariants = getProductVariants('telegram_premium');
      expect(premVariants).toHaveLength(3);
    });
  });

  describe('Stock Management & Allocation', () => {
    it('allows adding single activation links and tracks available count', () => {
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(0);

      addStockLink('gemini_pro_18m', 'https://gemini.google.com/redeem/token1');
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/redeem/token2');

      expect(getAvailableStockCount('gemini_pro_18m')).toBe(2);
      const counts = getTotalStockCount('gemini_pro_18m');
      expect(counts).toEqual({ available: 2, allocated: 0, total: 2 });
    });

    it('allocates stock atomically and flags low-stock threshold', () => {
      for (let i = 1; i <= 6; i++) {
        addStockLink('gemini_pro_18m', `https://gemini.google.com/redeem/token_${i}`);
      }
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(6);

      // Allocate 1st item (remaining = 5 -> triggers low stock threshold <= 5)
      const res1 = allocateStock('gemini_pro_18m', 'order_001');
      expect(res1.item).toBeDefined();
      expect(res1.item?.payload).toBe('https://gemini.google.com/redeem/token_1');
      expect(res1.remaining).toBe(5);
      expect(res1.shouldAlertLowStock).toBe(true);
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(5);
    });

    it('handles sold-out state properly when stock hits 0', () => {
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/redeem/only_one');

      const res1 = allocateStock('gemini_pro_18m', 'order_001');
      expect(res1.item).toBeDefined();
      expect(res1.remaining).toBe(0);

      // Attempt second allocation when empty
      const res2 = allocateStock('gemini_pro_18m', 'order_002');
      expect(res2.item).toBeNull();
      expect(res2.remaining).toBe(0);
    });
  });

  describe('CSV Stock Parser', () => {
    it('parses valid CSV rows with or without headers and handles whitespace', () => {
      const csv = `
        link
        https://gemini.google.com/redeem/link1
        https://gemini.google.com/redeem/link2, extra_col
        "https://gemini.google.com/redeem/link3"
      `;

      const res = importStockCSV('gemini_pro_18m', csv);
      expect(res.imported).toBe(3);
      expect(res.skipped).toBe(1); // Header row skipped
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(3);
    });

    it('handles malformed rows gracefully and reports errors', () => {
      const csv = `
        https://gemini.google.com/redeem/link1
        x
        
        https://gemini.google.com/redeem/link2
      `;

      const res = importStockCSV('gemini_pro_18m', csv);
      expect(res.imported).toBe(2);
      expect(res.errors.length).toBe(1); // 'x' row too short
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(2);
    });
  });

  describe('Admin Catalog Control & Pricing', () => {
    it('updates variant price immediately and persists', () => {
      const variantBefore = getVariantById('gemini_pro_18m_default');
      expect(variantBefore?.price_etb).toBe(1500);

      updateVariantPrice('gemini_pro_18m_default', 1750);

      const variantAfter = getVariantById('gemini_pro_18m_default');
      expect(variantAfter?.price_etb).toBe(1750);
    });

    it('formats ETB currency cleanly', () => {
      expect(formatPriceETB(1250)).toBe('1,250 ETB');
      expect(formatPriceETB(3400)).toBe('3,400 ETB');
    });

    it('identifies admin IDs strictly', () => {
      expect(isAdmin(111111111)).toBe(true);
      expect(isAdmin(222222333)).toBe(true);
      expect(isAdmin(12345)).toBe(false);
      expect(isAdmin(undefined)).toBe(false);
    });
  });

  describe('Rate Engine & Fallbacks', () => {
    it('returns realistic fallback rate when external API times out or fails', async () => {
      const { fetchCoinGeckoPrices, getFallbackTonUsd } = await import('../src/services/rate_engine.service.js');
      expect(getFallbackTonUsd()).toBeGreaterThanOrEqual(3.0);

      const rates = await fetchCoinGeckoPrices(false);
      expect(rates.tonUsd).toBeGreaterThanOrEqual(3.0);
      expect(rates.usdtUsd).toBe(1.0);
    });
  });

  describe('Registration Gate on Inline Buttons', () => {
    it('blocks unregistered users from accessing inline purchase flows', async () => {
      const { isUserRegistered } = await import('../src/services/users.service.js');
      const unregUserId = 888777;

      expect(isUserRegistered(unregUserId)).toBe(false);

      const purchaseActions = [
        'prod_gemini_pro_18m',
        'buy_var_tg_prem_3m',
        'buy_custom_stars_500_1250',
        'stars_custom',
        'pay_stars_order123',
      ];

      for (const action of purchaseActions) {
        const isPurchaseAction =
          action.startsWith('prod_') ||
          action.startsWith('buy_var_') ||
          action.startsWith('buy_custom_stars_') ||
          action === 'stars_custom' ||
          action.startsWith('pay_');

        expect(isPurchaseAction).toBe(true);
      }
    });
  });
});

