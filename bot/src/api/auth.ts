import crypto from 'crypto';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/index.js';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface ValidatedInitData {
  user: TelegramUser;
  auth_date: number;
  query_id?: string;
  hash: string;
}

export function validateTelegramInitData(initDataRaw: string, botToken?: string): ValidatedInitData | null {
  if (!initDataRaw) return null;

  const token = botToken || getConfig().BOT_TOKEN;
  if (!token) return null;

  try {
    const params = new URLSearchParams(initDataRaw);
    const hash = params.get('hash');
    if (!hash) return null;

    // Build data-check-string (all params sorted alphabetically except hash)
    const items: string[] = [];
    params.forEach((value, key) => {
      if (key !== 'hash') {
        items.push(`${key}=${value}`);
      }
    });
    items.sort();
    const dataCheckString = items.join('\n');

    // HMAC-SHA-256("WebAppData", botToken)
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();

    // HMAC-SHA-256(secretKey, dataCheckString)
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    // Constant-time comparison
    const hashBuffer = Buffer.from(hash, 'hex');
    const calculatedBuffer = Buffer.from(calculatedHash, 'hex');

    if (hashBuffer.length !== calculatedBuffer.length || !crypto.timingSafeEqual(hashBuffer, calculatedBuffer)) {
      logger.warn('Telegram initData signature verification failed');
      return null;
    }

    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (!authDate) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (authDate > nowSec || (nowSec - authDate) > 86400) {
      logger.warn({ authDate, nowSec }, 'Telegram initData auth_date expired or in future (>24h)');
      return null;
    }

    const userRaw = params.get('user');
    if (!userRaw) return null;

    const user = JSON.parse(userRaw) as TelegramUser;

    return {
      user,
      auth_date: authDate,
      query_id: params.get('query_id') || undefined,
      hash,
    };
  } catch (err) {
    logger.error({ err }, 'Error during Telegram initData validation');
    return null;
  }
}
