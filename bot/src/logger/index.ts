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
