import Database from 'better-sqlite3';
import { logger } from '../logger/index.js';

export function seedDatabase(db: Database.Database): void {
  logger.info('Seeding database with default catalog and settings...');

  const seedTx = db.transaction(() => {
    // 1. Products
    const insertProduct = db.prepare(`
      INSERT INTO products (id, type, name, description, is_active, meta)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);

    insertProduct.run(
      'gemini_pro_18m',
      'stock',
      'Gemini Pro (18 Months)',
      'Instant activation link for Google Gemini Pro 18-Month access. Includes 2TB cloud storage & advanced AI tools.',
      1,
      JSON.stringify({ low_stock_threshold: 5 })
    );

    insertProduct.run(
      'telegram_premium',
      'order',
      'Telegram Premium',
      'Direct Telegram Premium subscription activated to your public @username via Fragment.',
      1,
      JSON.stringify({})
    );

    insertProduct.run(
      'telegram_stars',
      'order',
      'Telegram Stars (Coins)',
      'Official Telegram Stars for gifts, mini-apps, bots, and digital media delivered to your @username.',
      1,
      JSON.stringify({ min_custom: 10, max_custom: 100000 })
    );

    // 2. Variants
    const insertVariant = db.prepare(`
      INSERT INTO variants (id, product_id, name, price_etb, is_active, sort_order, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);

    // Gemini Pro variant
    insertVariant.run('gemini_pro_18m_default', 'gemini_pro_18m', '18 Months Plan', 1500, 1, 1, '{}');

    // Telegram Premium variants
    insertVariant.run('tg_prem_3m', 'telegram_premium', '3 Months Subscription', 1100, 1, 1, JSON.stringify({ months: 3 }));
    insertVariant.run('tg_prem_6m', 'telegram_premium', '6 Months Subscription', 1900, 1, 2, JSON.stringify({ months: 6 }));
    insertVariant.run('tg_prem_12m', 'telegram_premium', '12 Months Subscription', 3400, 1, 3, JSON.stringify({ months: 12 }));

    // Telegram Stars preset packages
    insertVariant.run('tg_stars_50', 'telegram_stars', '50 Stars', 125, 1, 1, JSON.stringify({ stars_count: 50 }));
    insertVariant.run('tg_stars_100', 'telegram_stars', '100 Stars', 250, 1, 2, JSON.stringify({ stars_count: 100 }));
    insertVariant.run('tg_stars_250', 'telegram_stars', '250 Stars', 625, 1, 3, JSON.stringify({ stars_count: 250 }));
    insertVariant.run('tg_stars_500', 'telegram_stars', '500 Stars', 1250, 1, 4, JSON.stringify({ stars_count: 500 }));
    insertVariant.run('tg_stars_1000', 'telegram_stars', '1,000 Stars', 2500, 1, 5, JSON.stringify({ stars_count: 1000 }));
    insertVariant.run('tg_stars_2500', 'telegram_stars', '2,500 Stars', 6250, 1, 6, JSON.stringify({ stars_count: 2500 }));

    // 3. Settings
    const insertSetting = db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO NOTHING
    `);

    const defaultSettings: Record<string, string> = {
      etb_per_usd: '135',
      etb_per_star: '2.5',
      margin_pct: '5',
      stars_min: '10',
      stars_max: '100000',
      // Placeholder payment accounts — REAL merchant account numbers must
      // only ever be configured at runtime via the admin Settings panel or a
      // provisioned database, never committed to source control.
      cbe_account: '0000000000000',
      cbe_name: 'Bighabesha Shop',
      telebirr_account: '0000000000',
      telebirr_name: 'Bighabesha Shop',
      abyssinia_account: '0000000000000',
      abyssinia_name: 'Bighabesha Shop',
      low_stock_threshold: '5',
      // Growth & loyalty knobs (admin-editable)
      referral_l1_pct: '5',
      referral_l2_pct: '1',
      tier_silver_etb: '5000',
      tier_gold_etb: '20000',
      tier_discount_silver_pct: '2',
      tier_discount_gold_pct: '5',
      // Lifecycle
      recovery_reminder_hours: '2',
      order_ttl_hours: '24',
      // Restock forecasting
      restock_lead_days: '7',
      restock_safety_days: '3',
      // Rail fee assumptions for net-profit analytics
      chapa_fee_pct: '2',
      stars_cashout_pct: '10',
      wallet_gas_bps: '30',
      gemini_instructions:
        'After payment, you will receive a one-time activation link.\n\n1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.',
    };

    for (const [key, value] of Object.entries(defaultSettings)) {
      insertSetting.run(key, value);
    }
  });

  seedTx();
  logger.info('Database seeded successfully.');
}
