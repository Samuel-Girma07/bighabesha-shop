import { getDatabase } from '../db/index.js';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/index.js';

export const SUPPORT_MAX_MESSAGE_LENGTH = 2000;

export function isSupportBridgeEnabled(): boolean {
  return Boolean(getConfig().SUPPORT_GROUP_ID);
}

export interface SupportThread {
  id: number;
  user_id: number;
  forum_topic_id: number | null;
  status: 'open' | 'closed';
}

/** Returns the user's open thread, creating one (and its forum topic) as needed. */
export async function getOrCreateThread(
  api: any,
  userId: number,
  username: string | null,
  firstName: string
): Promise<SupportThread> {
  const db = getDatabase();
  const config = getConfig();
  const groupId = config.SUPPORT_GROUP_ID;
  if (!groupId) throw new Error('Support bridge is not configured');

  let thread = db.prepare(
    "SELECT * FROM support_threads WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1"
  ).get(userId) as SupportThread | undefined;

  if (!thread) {
    // Create the forum topic for this conversation.
    let topicId: number | null = null;
    try {
      const topic = await api.createForumTopic(groupId, `🛟 ${firstName || 'User'} #${userId} (@${username ?? 'nouser'})`);
      topicId = topic?.message_thread_id ?? null;
    } catch (err) {
      logger.error({ err, userId }, 'Failed to create support forum topic');
      throw new Error('Could not open a support conversation. Please try again later.');
    }

    const res = db.prepare('INSERT INTO support_threads (user_id, forum_topic_id) VALUES (?, ?)').run(userId, topicId);
    thread = db.prepare('SELECT * FROM support_threads WHERE id = ?').get(res.lastInsertRowid) as SupportThread;
  }

  return thread;
}

export function insertSupportMessage(threadId: number, senderRole: 'user' | 'admin' | 'system', body: string, tgMessageId?: number): void {
  getDatabase().prepare(
    'INSERT INTO support_messages (thread_id, sender_role, body, tg_message_id) VALUES (?, ?, ?, ?)'
  ).run(threadId, senderRole, body.slice(0, SUPPORT_MAX_MESSAGE_LENGTH), tgMessageId ?? null);
}

export function getThreadMessages(threadId: number, afterId: number = 0): any[] {
  return getDatabase().prepare(
    'SELECT id, sender_role, body, created_at FROM support_messages WHERE thread_id = ? AND id > ? ORDER BY id ASC LIMIT 200'
  ).all(threadId, afterId);
}

export function closeThread(threadId: number): boolean {
  const res = getDatabase().prepare("UPDATE support_threads SET status = 'closed' WHERE id = ?").run(threadId);
  return res.changes > 0;
}

/** Finds a thread by its forum topic id (admin reply routing). */
export function findThreadByTopic(forumTopicId: number): SupportThread | undefined {
  return getDatabase().prepare(
    'SELECT * FROM support_threads WHERE forum_topic_id = ? AND status = \'open\''
  ).get(forumTopicId) as SupportThread | undefined;
}
