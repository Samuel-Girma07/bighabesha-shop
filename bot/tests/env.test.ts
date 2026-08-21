import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('Environment Configuration Validation', () => {
  it('fails fast when BOT_TOKEN is missing', () => {
    expect(() =>
      loadEnv({
        ADMIN_IDS: '123456789',
      })
    ).toThrow(/BOT_TOKEN is required/);
  });

  it('fails fast when ADMIN_IDS is missing', () => {
    expect(() =>
      loadEnv({
        BOT_TOKEN: 'test_token',
      })
    ).toThrow(/ADMIN_IDS is required/);
  });

  it('fails fast when ADMIN_IDS contains non-numeric values', () => {
    expect(() =>
      loadEnv({
        BOT_TOKEN: 'test_token',
        ADMIN_IDS: '12345,invalid_id',
      })
    ).toThrow(/Invalid Admin ID in ADMIN_IDS/);
  });

  it('successfully parses valid environment variables and sets defaults', () => {
    const config = loadEnv({
      BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
      ADMIN_IDS: '123456789, 987654321',
      PORT: '4000',
    });

    expect(config.BOT_TOKEN).toBe('123456789:ABCdefGHIjklMNOpqrSTUvwxYZ');
    expect(config.ADMIN_IDS).toEqual([123456789, 987654321]);
    expect(config.WALLET_PAY_MODE).toBe('mock');
    expect(config.DATABASE_PATH).toBe('./data/shop.db');
    expect(config.PORT).toBe(4000);
    expect(config.SUPPORT_USERNAME).toBe('Vweah');
  });
});
