import { Api, RawApi } from 'grammy';
import crypto from 'crypto';
import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';

export interface BroadcastTarget {
  id: number;
  language_code: string;
}

export interface DeliveryResult {
  sent: number;
  failed: number;
  total: number;
}

export interface PacingOptions {
  /** Delay between individual messages (ms). ~35ms keeps under Telegram's 30 msg/s. */
  delayMs?: number;
  /** Number of messages per chunk. */
  chunkSize?: number;
  /** Pause between chunks (ms) — lets the event loop and rate limiter breathe. */
  chunkDelayMs?: number;
}

const DEFAULT_PACING: Required<PacingOptions> = {
  delayMs: 35,
  chunkSize: 100,
  chunkDelayMs: 1000,
};

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

/**
 * Core delivery loop — fully injectable so tests can exercise chunking,
 * pacing, and per-user error isolation without touching Telegram.
 * A single blocked/deactivated user NEVER aborts the run.
 */
export async function deliverBroadcast(
  targets: BroadcastTarget[],
  sender: (targetId: number) => Promise<void>,
  pacing: PacingOptions = {}
): Promise<DeliveryResult> {
  const { delayMs, chunkSize, chunkDelayMs } = { ...DEFAULT_PACING, ...pacing };

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += chunkSize) {
    const chunk = targets.slice(i, i + chunkSize);

    for (const target of chunk) {
      try {
        await sender(target.id);
        sent++;
      } catch (err: any) {
        // Per-user isolation: blocked bots / deactivated accounts are expected.
        failed++;
        logger.warn(
          { userId: target.id, err: err?.message || String(err) },
          'Broadcast message failed for user (continuing)'
        );
      }

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    if (i + chunkSize < targets.length && chunkDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
    }
  }

  return { sent, failed, total: targets.length };
}

// ---------------------------------------------------------------------------
// Background job registry (Web Admin Dashboard broadcasts)
// ---------------------------------------------------------------------------

export interface BroadcastJob {
  id: string;
  total: number;
  sent: number;
  failed: number;
  done: boolean;
  startedAt: number;
  finishedAt?: number;
  targetLanguage: string;
  hasPhoto: boolean;
}

const broadcastJobs = new Map<string, BroadcastJob>();
const MAX_TRACKED_JOBS = 20;

/** Thrown when the job registry is saturated with still-running broadcasts. */
export class BroadcastBusyError extends Error {
  constructor() {
    super('A broadcast is already in flight. Wait for it to finish before starting another.');
    this.name = 'BroadcastBusyError';
  }
}

export function getBroadcastJob(jobId: string): BroadcastJob | undefined {
  const inMemory = broadcastJobs.get(jobId);
  if (inMemory) return inMemory;

  try {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ?').get(jobId) as any;
    if (!row) return undefined;

    return {
      id: row.id,
      total: row.sent + row.failed,
      sent: row.sent,
      failed: row.failed,
      done: row.status === 'completed' || row.status === 'failed',
      startedAt: new Date(row.created_at).getTime(),
      finishedAt: row.status !== 'running' ? new Date(row.updated_at).getTime() : undefined,
      targetLanguage: row.target_lang || 'all',
      hasPhoto: false,
    };
  } catch {
    return undefined;
  }
}

export function listBroadcastJobs(): BroadcastJob[] {
  try {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM broadcast_jobs ORDER BY created_at DESC LIMIT 20').all() as any[];
    if (rows.length > 0) {
      return rows.map((row) => ({
        id: row.id,
        total: row.sent + row.failed,
        sent: row.sent,
        failed: row.failed,
        done: row.status === 'completed' || row.status === 'failed',
        startedAt: new Date(row.created_at).getTime(),
        finishedAt: row.status !== 'running' ? new Date(row.updated_at).getTime() : undefined,
        targetLanguage: row.target_lang || 'all',
        hasPhoto: false,
      }));
    }
  } catch {
    // Fall back to in-memory list
  }
  return [...broadcastJobs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

async function sendBroadcastMessage(
  api: Api<RawApi>,
  targetId: number,
  messageText: string,
  photoFileId?: string
): Promise<void> {
  if (photoFileId) {
    await api.sendPhoto(targetId, photoFileId, { caption: messageText, parse_mode: 'HTML' });
  } else {
    await api.sendMessage(targetId, messageText, { parse_mode: 'HTML' });
  }
}

/**
 * Launches a tracked background job over an EXPLICIT recipient id list
 * (used by the Web Admin API for segment targeting like "active buyers").
 */
export function startBroadcastJobFromIds(
  api: Api<RawApi>,
  params: { recipientIds: number[]; messageText: string; photoFileId?: string; pacing?: PacingOptions }
): BroadcastJob {
  const targets: BroadcastTarget[] = params.recipientIds.map((id) => ({ id, language_code: 'all' }));
  return startBroadcastJob(api, {
    messageText: params.messageText,
    photoFileId: params.photoFileId,
    targetLanguage: 'segment',
    pacing: params.pacing,
    _targetsOverride: targets,
  } as any);
}

/**
 * Launches a broadcast as a tracked background job. Returns immediately with
 * progress metadata so long-running fan-outs never block or time out the
 * originating HTTP request.
 */
export function startBroadcastJob(
  api: Api<RawApi>,
  params: { messageText: string; photoFileId?: string; targetLanguage?: string; pacing?: PacingOptions; _targetsOverride?: BroadcastTarget[] }
): BroadcastJob {
  const targets = params._targetsOverride ?? getBroadcastTargets(params.targetLanguage || 'all');

  // Keep the registry bounded — drop oldest finished jobs when over capacity.
  while (broadcastJobs.size >= MAX_TRACKED_JOBS) {
    const oldestFinished = [...broadcastJobs.values()]
      .filter((j) => j.done)
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    if (!oldestFinished) break;
    broadcastJobs.delete(oldestFinished.id);
  }

  // Hard bound: if every tracked job is still RUNNING, refuse rather than
  // silently growing memory (the previous eviction loop broke out and
  // inserted anyway, making the cap advisory only).
  if (broadcastJobs.size >= MAX_TRACKED_JOBS) {
    throw new BroadcastBusyError();
  }

  const job: BroadcastJob = {
    id: crypto.randomBytes(8).toString('hex'),
    total: targets.length,
    sent: 0,
    failed: 0,
    done: false,
    startedAt: Date.now(),
    targetLanguage: params.targetLanguage || 'all',
    hasPhoto: Boolean(params.photoFileId),
  };
  broadcastJobs.set(job.id, job);

  try {
    const db = getDatabase();
    db.prepare(
      "INSERT INTO broadcast_jobs (id, admin_id, status, target_lang, sent, failed, cursor_id) VALUES (?, 0, 'running', ?, 0, 0, 0)"
    ).run(job.id, job.targetLanguage);
  } catch (err) {
    logger.warn({ err, jobId: job.id }, 'Failed to insert broadcast job row');
  }

  logger.info({ jobId: job.id, total: job.total, targetLanguage: job.targetLanguage, hasPhoto: job.hasPhoto }, 'Background broadcast started');

  // Fire-and-forget worker — errors inside deliverBroadcast are already
  // isolated per user; this catch guards unexpected runner-level failures.
  void (async () => {
    try {
      const result = await deliverBroadcast(targets, async (targetId) => {
        await sendBroadcastMessage(api, targetId, params.messageText, params.photoFileId);
        try {
          const db = getDatabase();
          db.prepare(
            "UPDATE broadcast_jobs SET cursor_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).run(targetId, job.id);
        } catch {}
      },
        params.pacing
      );
      job.sent = result.sent;
      job.failed = result.failed;
    } catch (err) {
      logger.error({ err, jobId: job.id }, 'Broadcast runner crashed');
    } finally {
      job.done = true;
      job.finishedAt = Date.now();
      try {
        const db = getDatabase();
        db.prepare(
          "UPDATE broadcast_jobs SET sent = ?, failed = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(job.sent, job.failed, job.failed === job.total && job.total > 0 ? 'failed' : 'completed', job.id);
      } catch (err) {
        logger.warn({ err, jobId: job.id }, 'Failed to update final broadcast job status');
      }
      logger.info({ jobId: job.id, sent: job.sent, failed: job.failed }, 'Background broadcast finished');
    }
  })();

  return job;
}

/** Legacy in-process broadcast used by the bot admin flow. */
export async function executeBroadcast(
  api: Api<RawApi>,
  messageText: string,
  photoFileId?: string,
  targetLanguage: string = 'all'
): Promise<{ sent: number; failed: number; total: number }> {
  const targets = getBroadcastTargets(targetLanguage);
  logger.info({ total: targets.length, targetLanguage }, 'Starting broadcast dispatch');

  const result = await deliverBroadcast(
    targets,
    (targetId) => sendBroadcastMessage(api, targetId, messageText, photoFileId)
  );

  logger.info(result, 'Broadcast dispatch completed');
  return result;
}
