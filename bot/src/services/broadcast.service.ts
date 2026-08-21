import { Api, RawApi } from 'grammy';
import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';

export interface BroadcastTarget {
  id: number;
  language_code: string;
}

export function getBroadcastTargets(languageFilter?: string): BroadcastTarget[] {
  try {
    const db = getDatabase();
    if (!languageFilter || languageFilter === 'all') {
      return db.prepare('SELECT id, language_code FROM users').all() as BroadcastTarget[];
    }
    return db.prepare('SELECT id, language_code FROM users WHERE language_code = ?').all(languageFilter) as BroadcastTarget[];
  } catch (err) {
    logger.error({ err, languageFilter }, 'Failed to fetch broadcast targets');
    return [];
  }
}

export async function executeBroadcast(
  api: Api<RawApi>,
  messageText: string,
  photoFileId?: string,
  targetLanguage: string = 'all'
): Promise<{ sent: number; failed: number; total: number }> {
  const targets = getBroadcastTargets(targetLanguage);
  logger.info({ total: targets.length, targetLanguage }, 'Starting broadcast dispatch');

  let sent = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      if (photoFileId) {
        await api.sendPhoto(target.id, photoFileId, {
          caption: messageText,
          parse_mode: 'Markdown',
        });
      } else {
        await api.sendMessage(target.id, messageText, {
          parse_mode: 'Markdown',
        });
      }
      sent++;
    } catch (err: any) {
      logger.warn({ err: err.message, userId: target.id }, 'Broadcast message failed to send to user');
      failed++;
    }

    // Small rate-limiting sleep (25ms ~ 40 requests/sec maximum)
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  logger.info({ sent, failed, total: targets.length }, 'Broadcast dispatch completed');
  return { sent, failed, total: targets.length };
}
