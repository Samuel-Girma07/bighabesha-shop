import { getDatabase } from '../db/index.js';
import { isAdmin } from '../bot/handlers/admin.js';
import { logger } from '../logger/index.js';

export interface User {
  id: number;
  username: string | null;
  first_name: string | null;
  language_code: string;
  phone_number: string | null;
  is_registered: number;
  is_admin?: number;
  created_at: string;
  updated_at: string;
}

export function getUserById(userId: number): User | null {
  try {
    const db = getDatabase();
    return (db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User) || null;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to fetch user by id');
    return null;
  }
}

export function getAllUsers(): User[] {
  try {
    const db = getDatabase();
    return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as User[];
  } catch (err) {
    logger.error({ err }, 'Failed to fetch all users');
    return [];
  }
}

export function upsertUser(user: {
  id: number;
  username?: string | null;
  first_name?: string;
  language_code?: string;
}): User {
  const db = getDatabase();
  const adminFlag = isAdmin(user.id) ? 1 : 0;

  db.prepare(`
    INSERT INTO users (id, username, first_name, language_code, is_admin, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      username = COALESCE(excluded.username, users.username),
      first_name = COALESCE(excluded.first_name, users.first_name),
      language_code = COALESCE(excluded.language_code, users.language_code),
      is_admin = ?,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    user.id,
    user.username || null,
    user.first_name || 'User',
    user.language_code || 'en',
    adminFlag,
    adminFlag
  );

  return getUserById(user.id)!;
}

export function saveUserPhone(userId: number, phoneNumber: string): User {
  const db = getDatabase();

  // Ensure the user row exists before updating. Users can reach phone
  // registration via commands like /shop WITHOUT ever sending /start, so the
  // row may not exist yet — a bare UPDATE would silently no-op and trap the
  // user in an infinite re-registration loop.
  db.prepare(`
    INSERT INTO users (id, username, first_name)
    VALUES (?, NULL, 'User')
    ON CONFLICT(id) DO NOTHING
  `).run(userId);

  db.prepare(`
    UPDATE users
    SET phone_number = ?, is_registered = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(phoneNumber, userId);

  const user = getUserById(userId);
  if (!user || user.is_registered !== 1) {
    throw new Error(`Failed to persist phone registration for user ${userId}`);
  }
  return user;
}

export function isUserRegistered(userId: number): boolean {
  const user = getUserById(userId);
  return Boolean(user && user.is_registered === 1 && user.phone_number);
}

/**
 * Validates Ethiopian or international phone numbers.
 * Formats standard Ethiopian numbers (e.g. 0911223344, 0711223344, +251911223344) to +2519... / +2517...
 */
export function validatePhoneNumber(raw: string): { valid: boolean; formatted?: string; error?: string } {
  if (!raw) return { valid: false, error: 'Phone number cannot be empty.' };

  const cleaned = raw.replace(/[\s\-\(\)]/g, '').trim();

  // Ethiopian mobile: 09xxxxxxxx, 07xxxxxxxx, 2519xxxxxxxx, 2517xxxxxxxx, +2519xxxxxxxx, +2517xxxxxxxx
  const ethRegex = /^(?:\+?251|0)([79]\d{8})$/;
  const ethMatch = cleaned.match(ethRegex);

  if (ethMatch) {
    const nationalPart = ethMatch[1]; // e.g. 911223344
    return { valid: true, formatted: `+251${nationalPart}` };
  }

  // General international mobile (E.164 standard: + followed by 7 to 15 digits)
  const intlRegex = /^\+?[1-9]\d{6,14}$/;
  if (intlRegex.test(cleaned)) {
    const formatted = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
    return { valid: true, formatted };
  }

  return {
    valid: false,
    error: 'Invalid phone number format. Please enter an Ethiopian mobile number (e.g. 0911223344 or 0711223344) or share your contact using the button below.',
  };
}
