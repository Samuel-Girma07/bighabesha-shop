import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Produces a non-reversible, length-revealing preview of a sensitive value:
 * `abcd…wxyz(32)`. Safe for correlating log lines without leaking payloads.
 */
export function redactSecret(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.length === 0) return '';
  if (str.length <= 8) return `***(${str.length})`;
  return `${str.slice(0, 4)}…${str.slice(-4)}(${str.length})`;
}

/**
 * Reduces a proxy URI to a credential-free `host[:port]` endpoint suitable for
 * external output (API responses, operator alerts).
 *
 * Egress proxy URIs embed `user:pass@` credentials. Those must never leave the
 * process, so this strips the scheme, the userinfo segment, and any path/query.
 * Deliberately string-based rather than `new URL()`: a malformed proxy URI must
 * still be reduced to something safe instead of throwing and leaking the raw
 * value via an unhandled fallback.
 */
export function sanitizeProxyEndpoint(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  const withoutScheme = raw.replace(/^[a-z0-9+.-]+:\/\//i, '');
  // Everything before the LAST '@' is userinfo — including the password separator.
  const afterUserinfo = withoutScheme.includes('@')
    ? withoutScheme.slice(withoutScheme.lastIndexOf('@') + 1)
    : withoutScheme;
  const hostPort = afterUserinfo.split(/[/?#]/)[0];

  // Defensive: if any userinfo separator survived, drop the segment entirely
  // rather than emitting a partially-redacted credential.
  return hostPort.includes('@') ? '' : hostPort;
}

/** Truncates free-form user text for logging: content preview + length only. */
export function previewUserText(text: unknown, maxLen: number = 40): string {
  if (text === null || text === undefined) return '';
  const str = String(text).replace(/\s+/g, ' ').trim();
  if (str.length === 0) return '';
  return str.length <= maxLen ? str : `${str.slice(0, maxLen)}…(${str.length})`;
}

export const LOGGER_REDACT_PATHS = [
  // Credentials & secrets
  'password',
  '*.password',
  'otp',
  '*.otp',
  'otpCode',
  '*.otpCode',
  'sessionToken',
  '*.sessionToken',
  'apiKey',
  '*.apiKey',
  'WALLET_PAY_API_KEY',
  '*.WALLET_PAY_API_KEY',
  'GRAMIX_API_KEY',
  '*.GRAMIX_API_KEY',
  'ISTAR_API_KEY',
  '*.ISTAR_API_KEY',
  'RESELLER_API_KEY',
  '*.RESELLER_API_KEY',
  // Backblaze B2 / Litestream object-storage credentials. These were NOT
  // redacted before Phase 0. A credential that can write and delete every
  // object in the backup bucket is worth more than the database it protects:
  // an attacker holding it can delete every replica, which is the only recovery
  // path for the encrypted secrets below.
  'B2_KEY_ID',
  '*.B2_KEY_ID',
  'B2_APPLICATION_KEY',
  '*.B2_APPLICATION_KEY',
  'LITESTREAM_ACCESS_KEY_ID',
  '*.LITESTREAM_ACCESS_KEY_ID',
  'LITESTREAM_SECRET_ACCESS_KEY',
  '*.LITESTREAM_SECRET_ACCESS_KEY',
  // ── Payment rebuild encrypted settings ───────────────────────────────────
  //
  // NOTE: pino's `redact.paths` does NOT support shell-style prefix wildcards.
  // A bare `*` means "this property name at any nesting depth", so `*.KEY`
  // would only match a property literally named `KEY`. Every secret below is
  // therefore enumerated by its concrete name, plus the `*.name` variant that
  // covers the same key appearing inside a nested object.
  //
  // `SECRET_ENCRYPTION_KEY` is the master key: it decrypts every other value on
  // this list, so it must never reach a log line under any circumstance.
  'SECRET_ENCRYPTION_KEY',
  '*.SECRET_ENCRYPTION_KEY',
  'verify_links_api_key',
  '*.verify_links_api_key',
  'verify_verifyet_api_key',
  '*.verify_verifyet_api_key',
  'provider_gramix_api_key',
  '*.provider_gramix_api_key',
  'provider_catfee_api_key',
  '*.provider_catfee_api_key',
  'provider_catfee_api_secret',
  '*.provider_catfee_api_secret',
  'provider_mystars_api_key',
  '*.provider_mystars_api_key',
  'provider_mystars_webhook_secret',
  '*.provider_mystars_webhook_secret',
  'provider_mystars_wallet_seed',
  '*.provider_mystars_wallet_seed',
  // Field-name spellings used by the secret store and the admin routes.
  'walletSeed',
  '*.walletSeed',
  'webhookSecret',
  '*.webhookSecret',
  'apiSecret',
  '*.apiSecret',
  // Egress proxy URIs embed user:pass credentials.
  'proxyUrl',
  '*.proxyUrl',
  // Sanitised endpoints must still never be logged verbatim: they disclose the
  // operator's egress provider and exit IP to anyone with log access.
  'proxyHost',
  '*.proxyHost',
  'proxyEndpoint',
  '*.proxyEndpoint',
  'RECEIPT_ETHIOPIA_PROXY_URL',
  '*.RECEIPT_ETHIOPIA_PROXY_URL',
  'ADMIN_PASSWORD',
  'BOT_TOKEN',
  'token',
  '*.token',
  'authorization',
  'req.headers.authorization',
  // Telegram payment identifiers
  'telegram_payment_charge_id',
  'payment.telegram_payment_charge_id',
  // Stock payloads (activation links) when logged under known keys
  'payload',
  'link',
  'activationLink',
];

export const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? 'silent' : isDev ? 'debug' : 'info'),
  redact: {
    paths: LOGGER_REDACT_PATHS,
    censor: '[REDACTED]',
  },
  transport:
    isDev && !isTest
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});
