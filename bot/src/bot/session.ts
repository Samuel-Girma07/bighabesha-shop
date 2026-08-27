import { getDatabase } from '../db/index.js';

export interface PendingAction {
  type:
    | 'user_receipt_upload'
    | 'admin_reject_reason'
    | 'admin_edit_variant_price'
    | 'admin_stock_single_paste'
    | 'admin_stock_csv_paste'
    | 'admin_edit_setting'
    | 'promo_entry'
    | 'user_sms_forward';
  data?: Record<string, any>;
  expiresAt: number;
}

export function setPendingAction(userId: number, action: Omit<PendingAction, 'expiresAt'>, ttlMinutes: number = 10): void {
  const db = getDatabase();
  const expiresAt = Date.now() + ttlMinutes * 60 * 1000;
  const dataJson = JSON.stringify(action.data || {});

  db.prepare(`
    INSERT INTO bot_sessions (user_id, type, data, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      type = excluded.type,
      data = excluded.data,
      expires_at = excluded.expires_at
  `).run(userId, action.type, dataJson, expiresAt);
}

export function getPendingAction(userId: number): PendingAction | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT user_id, type, data, expires_at FROM bot_sessions WHERE user_id = ?').get(userId) as {
    user_id: number;
    type: string;
    data: string;
    expires_at: number;
  } | undefined;

  if (!row) return undefined;

  if (row.expires_at && Date.now() > row.expires_at) {
    db.prepare('DELETE FROM bot_sessions WHERE user_id = ?').run(userId);
    return undefined;
  }

  let parsedData: Record<string, any> = {};
  try {
    parsedData = JSON.parse(row.data);
  } catch {}

  return {
    type: row.type as any,
    data: parsedData,
    expiresAt: row.expires_at,
  };
}

export function clearPendingAction(userId: number): void {
  const db = getDatabase();
  db.prepare('DELETE FROM bot_sessions WHERE user_id = ?').run(userId);
}
