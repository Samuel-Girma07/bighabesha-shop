import crypto from 'crypto';
import { getDatabase } from '../db/index.js';
import { getNumericSetting } from './settings.service.js';
import { logger } from '../logger/index.js';

export function getLedgerBalance(userId: number): number {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE direction WHEN 'credit' THEN amount_etb ELSE -amount_etb END), 0) AS balance
    FROM ledger_entries WHERE user_id = ?
  `).get(userId) as { balance: number };
  return row?.balance ?? 0;
}

export function getOrCreateReferralCode(userId: number, _firstName?: string | null): string {
  const db = getDatabase();
  const existing = db.prepare('SELECT referral_code FROM users WHERE id = ?').get(userId) as { referral_code: string | null } | undefined;
  if (existing?.referral_code) return existing.referral_code;

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = `REF${userId.toString(36).toUpperCase()}${cryptoRandom(3)}`;
    try {
      db.prepare('UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL').run(code, userId);
      const after = db.prepare('SELECT referral_code FROM users WHERE id = ?').get(userId) as { referral_code: string };
      if (after.referral_code) return after.referral_code;
    } catch {
      // unique collision — retry with fresh suffix
    }
  }
  logger.warn({ userId }, 'Could not allocate a unique referral code');
  return `REF${userId}`;
}

function cryptoRandom(len: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

export interface ReferralAttributionResult {
  attributed: boolean;
  reason?: string;
}

/**
 * Attributes a buyer to a referrer via deep-link payload (`ref_<CODE>`).
 * Only brand-new users (no purchases, no prior referrer) can be attributed,
 * and self-referral is impossible by construction.
 */
export function attributeReferral(newUserId: number, payload: string): ReferralAttributionResult {
  const db = getDatabase();
  if (!payload || !payload.startsWith('ref_')) return { attributed: false };

  const code = payload.slice(4).trim().toUpperCase();
  if (!code) return { attributed: false };

  const owner = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(code) as { id: number } | undefined;
  if (!owner) return { attributed: false, reason: 'unknown_code' };
  if (owner.id === newUserId) return { attributed: false, reason: 'self_referral' };

  const user = db.prepare('SELECT referrer_id FROM users WHERE id = ?').get(newUserId) as { referrer_id: number | null };
  if (user.referrer_id) return { attributed: false, reason: 'already_attributed' };

  const hasPurchases = db.prepare('SELECT COUNT(*) c FROM orders WHERE user_id = ?').get(newUserId) as { c: number };
  if (hasPurchases.c > 0) return { attributed: false, reason: 'existing_customer' };

  db.prepare('UPDATE users SET referrer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(owner.id, newUserId);
  logger.info({ newUserId, referrerId: owner.id }, 'Referral attributed');
  return { attributed: true };
}

export function getReferralSummary(userId: number) {
  const db = getDatabase();
  const downline = db.prepare('SELECT COUNT(*) c FROM users WHERE referrer_id = ?').get(userId) as { c: number };
  return {
    code: getOrCreateReferralCode(userId),
    balanceEtb: getLedgerBalance(userId),
    referredUsers: downline.c,
    commissionRatePct: getNumericSetting('referral_l1_pct', 5),
    recentEntries: db.prepare(
      'SELECT direction, amount_etb, type, ref_order_id, created_at FROM ledger_entries WHERE user_id = ? ORDER BY id DESC LIMIT 20'
    ).all(userId),
  };
}
