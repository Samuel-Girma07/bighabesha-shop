import { getDatabase } from '../db/index.js';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/index.js';

export type AdminRole = 'superadmin' | 'ops' | 'finance' | 'support';

export type Permission =
  | 'orders.view'
  | 'orders.decide'
  | 'stock.manage'
  | 'users.view'
  | 'settings.read'
  | 'settings.write'
  | 'broadcast.send'
  | 'audit.view'
  | 'payouts.manage'
  | 'analytics.view'
  | 'export.financial';

export const ALL_PERMISSIONS: Permission[] = [
  'orders.view', 'orders.decide', 'stock.manage', 'users.view',
  'settings.read', 'settings.write', 'broadcast.send', 'audit.view',
  'payouts.manage', 'analytics.view', 'export.financial',
];

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  superadmin: [...ALL_PERMISSIONS],
  ops: ['orders.view', 'orders.decide', 'stock.manage', 'users.view', 'settings.read', 'broadcast.send', 'analytics.view'],
  finance: ['orders.view', 'users.view', 'settings.read', 'payouts.manage', 'analytics.view', 'export.financial'],
  support: ['orders.view', 'users.view'],
};

export function roleHasPermission(role: AdminRole, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

/**
 * Self-healing backfill: ensures every ADMIN_IDS member has an active
 * superadmin row. Called at boot and lazily on first sight of a legacy
 * session so pre-RBAC databases keep working without manual migration.
 */
export function ensureAdminRow(tgUserId: number): AdminRole | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT role, is_active FROM admins WHERE tg_user_id = ?')
    .get(tgUserId) as { role: AdminRole; is_active: number } | undefined;

  if (row) {
    return row.is_active ? row.role : null;
  }

  // Legacy path: configured ADMIN_IDS are trusted as superadmins.
  if (getConfig().ADMIN_IDS.includes(tgUserId)) {
    db.prepare(
      "INSERT INTO admins (tg_user_id, role, is_active, created_by) VALUES (?, 'superadmin', 1, 'env-backfill') ON CONFLICT(tg_user_id) DO NOTHING"
    ).run(tgUserId);
    logger.info({ tgUserId }, 'Backfilled superadmin row from ADMIN_IDS');
    return 'superadmin';
  }
  return null;
}

/** One-time boot sync of all ADMIN_IDS members. */
export function syncAdminsFromEnv(): void {
  for (const id of getConfig().ADMIN_IDS) {
    ensureAdminRow(id);
  }
}
