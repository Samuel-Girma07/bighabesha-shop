export interface PendingAction {
  type:
    | 'stars_custom_amount'
    | 'admin_edit_variant_price'
    | 'admin_stock_single_paste'
    | 'admin_stock_csv_paste'
    | 'admin_edit_setting';
  data?: Record<string, any>;
  expiresAt: number;
}

const userSessions = new Map<number, PendingAction>();

export function setPendingAction(userId: number, action: Omit<PendingAction, 'expiresAt'>, ttlMinutes: number = 10): void {
  userSessions.set(userId, {
    ...action,
    expiresAt: Date.now() + ttlMinutes * 60 * 1000,
  });
}

export function getPendingAction(userId: number): PendingAction | undefined {
  const session = userSessions.get(userId);
  if (!session) return undefined;

  if (Date.now() > session.expiresAt) {
    userSessions.delete(userId);
    return undefined;
  }

  return session;
}

export function clearPendingAction(userId: number): void {
  userSessions.delete(userId);
}
