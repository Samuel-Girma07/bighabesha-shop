-- 009_decommission_stars.sql
-- Gracefully decommission Telegram Stars product, variants, and settings.

-- 1. Deactivate Telegram Stars product and variants so they never appear in catalog queries
UPDATE products SET is_active = 0 WHERE id = 'telegram_stars';
UPDATE variants SET is_active = 0 WHERE product_id = 'telegram_stars';

-- 2. Remove obsolete Stars settings from the settings table
DELETE FROM settings WHERE key IN ('etb_per_star', 'stars_min', 'stars_max', 'stars_cashout_pct');
