import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { setSetting, setSettings, getSetting } from '../src/services/settings.service.js';
import { logger, LOGGER_REDACT_PATHS, redactSecret } from '../src/logger/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
process.env.ADMIN_IDS = process.env.ADMIN_IDS || '111111111';

/** A realistic proxy URI: the userinfo section is the credential we must never see. */
const PROXY_URI = 'http://ethiopia-proxy-user:s3cr3tP@ssw0rd@proxy.example.com:8080';
const PROXY_PASSWORD = 's3cr3tP@ssw0rd';

/**
 * Serializes every object handed to the logger during the test. The pino logger runs
 * at `silent` level under vitest, so capturing stdout would assert nothing — we
 * inspect the actual call arguments instead.
 */
function captureLogArgs(run: () => void): string {
  const seen: unknown[] = [];
  const collect = (arg: unknown) => seen.push(arg);
  const infoSpy = vi.spyOn(logger, 'info').mockImplementation(collect as never);
  const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(collect as never);
  const errorSpy = vi.spyOn(logger, 'error').mockImplementation(collect as never);
  const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(collect as never);
  try {
    run();
  } finally {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
  }
  let out = '';
  for (const entry of seen) {
    try {
      out += JSON.stringify(entry) ?? '';
    } catch {
      out += String(entry);
    }
  }
  return out;
}

describe('Settings logging does not leak credential values', () => {
  beforeEach(() => {
    initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDatabase();
  });

  it('does not write the raw proxy URI when the proxy setting is saved', () => {
    const log = captureLogArgs(() => setSetting('receipt_ethiopia_proxy_url', PROXY_URI));

    expect(log).not.toContain(PROXY_PASSWORD);
    expect(log).not.toContain('ethiopia-proxy-user');
    expect(log).not.toContain(PROXY_URI);
  });

  it('keeps the setting key so log lines stay correlatable', () => {
    const log = captureLogArgs(() => setSetting('receipt_ethiopia_proxy_url', PROXY_URI));
    expect(log).toContain('receipt_ethiopia_proxy_url');
  });

  it('actually persists the value so redaction is not masking a broken write', () => {
    setSetting('receipt_ethiopia_proxy_url', PROXY_URI);
    expect(getSetting('receipt_ethiopia_proxy_url')).toBe(PROXY_URI);
  });

  it('does not leak values in the batch update path either', () => {
    const log = captureLogArgs(() =>
      setSettings({ receipt_ethiopia_proxy_url: PROXY_URI, some_other_key: 'plain-value' })
    );

    expect(log).not.toContain(PROXY_PASSWORD);
    expect(log).not.toContain(PROXY_URI);
  });

  it('does not leak a beneficiary account list', () => {
    const beneficiaries = JSON.stringify(['1000123456789', '0911223344']);
    const log = captureLogArgs(() => setSetting('receipt_cbe_beneficiaries', beneficiaries));

    expect(log).not.toContain('1000123456789');
  });

  it('declares proxy paths in the shared redact list', () => {
    expect(LOGGER_REDACT_PATHS).toContain('proxyUrl');
    expect(LOGGER_REDACT_PATHS).toContain('*.proxyUrl');
    expect(LOGGER_REDACT_PATHS).toContain('RECEIPT_ETHIOPIA_PROXY_URL');
  });

  it('redactSecret masks a URI but keeps enough shape to stay diagnosable', () => {
    const masked = redactSecret(PROXY_URI);
    expect(masked).not.toContain(PROXY_PASSWORD);
    expect(masked).toContain('…');
    expect(masked).toContain(String(PROXY_URI.length));
  });

  it('redactSecret collapses short values entirely', () => {
    expect(redactSecret('abc')).toBe('***(3)');
    expect(redactSecret('')).toBe('');
    expect(redactSecret(null)).toBe('');
  });
});
