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

/** Truncates free-form user text for logging: content preview + length only. */
export function previewUserText(text: unknown, maxLen: number = 40): string {
  if (text === null || text === undefined) return '';
  const str = String(text).replace(/\s+/g, ' ').trim();
  if (str.length === 0) return '';
  return str.length <= maxLen ? str : `${str.slice(0, maxLen)}…(${str.length})`;
}

export const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? 'silent' : isDev ? 'debug' : 'info'),
  redact: {
    paths: [
      // Credentials & secrets
      'password',
      '*.password',
      'otp',
      '*.otp',
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
    ],
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
