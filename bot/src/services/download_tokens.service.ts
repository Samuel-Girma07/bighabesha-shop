import crypto from 'crypto';
import { getSetting, setSetting } from './settings.service.js';
import { logger } from '../logger/index.js';

/**
 * Stateless, short-lived HMAC download tokens for admin media (receipts).
 *
 * Why: <img>/<a> tags cannot send Authorization headers, so the dashboard
 * previously embedded the long-lived session token in the query string,
 * leaking it into proxy logs, browser history, and Referer headers. These
 * tokens are purpose-scoped, bound to a single order, and expire in 60s —
 * safe to expose in URLs.
 */

const TOKEN_PURPOSE = 'receipt-dl-v1';
const TOKEN_TTL_MS = 60 * 1000;

function getDownloadSecret(): string {
  let secret = getSetting('download_link_secret', '');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting('download_link_secret', secret);
    logger.info('Generated persistent download-link signing secret');
  }
  return secret;
}

function sign(body: string): string {
  return crypto.createHmac('sha256', getDownloadSecret()).update(`${TOKEN_PURPOSE}:${body}`).digest('base64url');
}

export function createReceiptDownloadToken(
  orderId: string,
  nowMs: number = Date.now()
): { url: string; expiresIn: number } {
  const exp = nowMs + TOKEN_TTL_MS;
  // Nonce keeps identical requests byte-distinct (no security role).
  const nonce = crypto.randomBytes(8).toString('hex');
  const body = `${orderId}|${exp}|${nonce}`;
  return {
    url: `/api/admin/receipt-dl/${encodeURIComponent(body)}/${sign(body)}`,
    expiresIn: Math.floor(TOKEN_TTL_MS / 1000),
  };
}

/** Returns the orderId on success; null for expired, tampered, or foreign tokens. */
export function verifyReceiptDownloadToken(payload: string, sig: string, nowMs: number = Date.now()): string | null {
  try {
    const body = decodeURIComponent(payload);
    const parts = body.split('|');
    if (parts.length !== 3) return null;

    const [orderId, expStr] = parts;
    const exp = Number(expStr);
    if (!orderId || !Number.isSafeInteger(exp) || exp < nowMs) return null;

    const expected = Buffer.from(sign(body));
    const provided = Buffer.from(sig);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return null;
    }
    return orderId;
  } catch {
    return null;
  }
}
