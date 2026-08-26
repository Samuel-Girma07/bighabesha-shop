import { getDatabase } from '../db/index.js';
import { getNumericSetting } from './settings.service.js';

export type Tier = 'bronze' | 'silver' | 'gold';

export interface UserStats {
  user_id: number;
  lifetime_etb: number;
  orders_count: number;
  tier: Tier;
}

export function getUserStats(userId: number): UserStats {
  const db = getDatabase();
  return db
    .prepare('SELECT user_id, lifetime_etb, orders_count, tier FROM user_stats WHERE user_id = ?')
    .get(userId) as UserStats ?? { user_id: userId, lifetime_etb: 0, orders_count: 0, tier: 'bronze' };
}

export function tierForLifetime(lifetimeEtb: number): Tier {
  const silver = getNumericSetting('tier_silver_etb', 5000);
  const gold = getNumericSetting('tier_gold_etb', 20000);
  if (lifetimeEtb >= gold) return 'gold';
  if (lifetimeEtb >= silver) return 'silver';
  return 'bronze';
}

/** Adjusts a user's lifetime stats and re-derives their tier. Delta may be negative (refunds). */
export function adjustUserStats(userId: number, amountDeltaEtb: number, orderCountDelta: number): UserStats {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO user_stats (user_id, lifetime_etb, orders_count) VALUES (?, MAX(?, 0), MAX(?, 0))
     ON CONFLICT(user_id) DO UPDATE SET
       lifetime_etb = MAX(user_stats.lifetime_etb + ?, 0),
       orders_count = MAX(user_stats.orders_count + ?, 0),
       updated_at = CURRENT_TIMESTAMP`
  ).run(
    userId,
    Math.max(amountDeltaEtb, 0), Math.max(orderCountDelta, 0),
    amountDeltaEtb, orderCountDelta
  );

  const stats = getUserStats(userId);
  const tier = tierForLifetime(stats.lifetime_etb);
  if (tier !== stats.tier) {
    db.prepare('UPDATE user_stats SET tier = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(tier, userId);
    stats.tier = tier;
  }
  return { ...stats, tier };
}

export function tierDiscountPct(tier: Tier): number {
  if (tier === 'gold') return getNumericSetting('tier_discount_gold_pct', 5);
  if (tier === 'silver') return getNumericSetting('tier_discount_silver_pct', 2);
  return 0;
}
