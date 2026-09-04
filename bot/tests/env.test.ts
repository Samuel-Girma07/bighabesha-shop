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
      ADMIN_IDS: '123456789, 222222333',
      PORT: '4000',
    });

    expect(config.BOT_TOKEN).toBe('123456789:ABCdefGHIjklMNOpqrSTUvwxYZ');
    expect(config.ADMIN_IDS).toEqual([123456789, 222222333]);
    expect(config.WALLET_PAY_MODE).toBe('mock');
    expect(config.DATABASE_PATH).toBe('./data/shop.db');
    expect(config.PORT).toBe(4000);
    expect(config.SUPPORT_USERNAME).toBe('Vweah');
  });

  it('correctly validates and parses dual-provider cascade reseller configuration', () => {
    const config = loadEnv({
      BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
      ADMIN_IDS: '123456789',
      RESELLER_PROVIDER: 'both',
      GRAMIX_API_KEY: 'gramix_key_123',
      ISTAR_API_KEY: 'istar_key_456',
      GRAMIX_API_URL: 'https://api.gramix.io/v1',
      ISTAR_API_URL: '',
    });

    expect(config.RESELLER_PROVIDER).toBe('both');
    expect(config.GRAMIX_API_KEY).toBe('gramix_key_123');
    expect(config.ISTAR_API_KEY).toBe('istar_key_456');
    expect(config.GRAMIX_API_URL).toBe('https://api.gramix.io/v1');
    expect(config.ISTAR_API_URL).toBeUndefined();

    const cascadeConfig = loadEnv({
      BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
      ADMIN_IDS: '123456789',
      RESELLER_PROVIDER: 'cascade',
    });
    expect(cascadeConfig.RESELLER_PROVIDER).toBe('cascade');
    expect(cascadeConfig.GRAMIX_API_KEY).toBe('');
    expect(cascadeConfig.ISTAR_API_KEY).toBe('');
  });

  it('automatically derives DATABASE_PATH and RECEIPTS_DIR when DATA_DIR is provided', () => {
    const config = loadEnv({
      BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
      ADMIN_IDS: '123456789',
      DATA_DIR: '/var/data',
    });

    expect(config.DATA_DIR).toBe('/var/data');
    expect(config.DATABASE_PATH).toMatch(/[\\/]var[\\/]data[\\/]shop\.db$/);
    expect(config.RECEIPTS_DIR).toMatch(/[\\/]var[\\/]data[\\/]receipts$/);
  });

  it('allows explicit DATABASE_PATH and RECEIPTS_DIR overrides even when DATA_DIR is set', () => {
    const config = loadEnv({
      BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
      ADMIN_IDS: '123456789',
      DATA_DIR: '/var/data',
      DATABASE_PATH: '/custom/store.db',
      RECEIPTS_DIR: '/custom/receipts_dir',
    });

    expect(config.DATA_DIR).toBe('/var/data');
    expect(config.DATABASE_PATH).toBe('/custom/store.db');
    expect(config.RECEIPTS_DIR).toBe('/custom/receipts_dir');
  });

  it('correctly normalizes Backblaze B2 and Litestream configuration variables', () => {
    const config = loadEnv({
      BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
      ADMIN_IDS: '123456789',
      B2_BUCKET: 'bighabesha-backup',
      B2_ENDPOINT: 's3.us-west-004.backblazeb2.com',
      B2_KEY_ID: '004key123',
      B2_APPLICATION_KEY: 'secretAppKey456',
      B2_REGION: 'us-west-004',
    });

    expect(config.B2_BUCKET).toBe('bighabesha-backup');
    expect(config.B2_ENDPOINT).toBe('s3.us-west-004.backblazeb2.com');
    expect(config.B2_KEY_ID).toBe('004key123');
    expect(config.B2_APPLICATION_KEY).toBe('secretAppKey456');
    expect(config.B2_REGION).toBe('us-west-004');
    expect(config.LITESTREAM_BUCKET).toBe('bighabesha-backup');
    expect(config.LITESTREAM_ACCESS_KEY_ID).toBe('004key123');
  });
});
