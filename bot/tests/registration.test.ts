import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import {
  upsertUser,
  saveUserPhone,
  isUserRegistered,
  validatePhoneNumber,
  getUserById,
} from '../src/services/users.service.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phone Number Registration & Validation', () => {
  let db: Database.Database;
  const migrationsDir = path.join(__dirname, '../src/db/migrations');

  beforeEach(() => {
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = '1397163638';
    db = initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('Phone Number Validator', () => {
    it('formats standard Ethio Telecom mobile numbers to +251 format', () => {
      const res = validatePhoneNumber('0911223344');
      expect(res.valid).toBe(true);
      expect(res.formatted).toBe('+251911223344');
    });

    it('formats standard Safaricom Ethiopia mobile numbers to +251 format', () => {
      const res = validatePhoneNumber('0711223344');
      expect(res.valid).toBe(true);
      expect(res.formatted).toBe('+251711223344');
    });

    it('handles numbers entered with +251 country code', () => {
      const res = validatePhoneNumber('+251912345678');
      expect(res.valid).toBe(true);
      expect(res.formatted).toBe('+251912345678');
    });

    it('handles spaces and dashes gracefully', () => {
      const res = validatePhoneNumber('09 11-22 33 44');
      expect(res.valid).toBe(true);
      expect(res.formatted).toBe('+251911223344');
    });

    it('accepts valid international format', () => {
      const res = validatePhoneNumber('+14155552671');
      expect(res.valid).toBe(true);
      expect(res.formatted).toBe('+14155552671');
    });

    it('rejects invalid or gibberish input', () => {
      expect(validatePhoneNumber('').valid).toBe(false);
      expect(validatePhoneNumber('hello world').valid).toBe(false);
      expect(validatePhoneNumber('1234').valid).toBe(false);
    });
  });

  describe('User Registration Lifecycle', () => {
    it('identifies unregistered users before phone submission and registered users after', () => {
      const user = upsertUser({
        id: 999111,
        username: 'test_ethio_user',
        first_name: 'Dawit',
      });

      expect(isUserRegistered(999111)).toBe(false);

      const registered = saveUserPhone(999111, '+251911223344');
      expect(registered.is_registered).toBe(1);
      expect(registered.phone_number).toBe('+251911223344');

      expect(isUserRegistered(999111)).toBe(true);

      const loaded = getUserById(999111);
      expect(loaded?.phone_number).toBe('+251911223344');
    });
  });
});
