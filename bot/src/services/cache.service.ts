import { logger } from '../logger/index.js';

interface Entry<T> {
  value: T;
  freshUntil: number;
  staleUntil: number;
  inflight: Promise<T> | null;
}

const store = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 5000;

export interface CacheOptions {
  ttlMs: number;
  staleMs?: number;
}

export async function cached<T>(key: string, opts: CacheOptions, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const staleMs = opts.staleMs ?? opts.ttlMs * 10;
  const entry = store.get(key) as Entry<T> | undefined;

  if (entry && now < entry.freshUntil) return entry.value;

  if (entry && now < entry.staleUntil) {
    if (!entry.inflight) {
      entry.inflight = loader()
        .then((value) => {
          entry.value = value;
          entry.freshUntil = Date.now() + opts.ttlMs;
          entry.staleUntil = Date.now() + opts.ttlMs + staleMs;
          return value;
        })
        .catch((err) => {
          logger.warn({ err, key }, 'Background cache refresh failed; continuing to serve stale value');
          return entry.value;
        })
        .finally(() => {
          entry.inflight = null;
        });
    }
    return entry.value;
  }

  if (entry?.inflight) return entry.inflight;

  const inflight = loader();
  const fresh: Entry<T> = {
    value: undefined as unknown as T,
    freshUntil: 0,
    staleUntil: 0,
    inflight,
  };
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
  store.set(key, fresh as Entry<unknown>);

  try {
    const value = await inflight;
    fresh.value = value;
    fresh.freshUntil = Date.now() + opts.ttlMs;
    fresh.staleUntil = Date.now() + opts.ttlMs + staleMs;
    return value;
  } catch (err) {
    store.delete(key);
    throw err;
  } finally {
    fresh.inflight = null;
  }
}

export function cachedSync<T>(key: string, ttlMs: number, loader: () => T): T {
  const now = Date.now();
  const entry = store.get(key) as Entry<T> | undefined;
  if (entry && now < entry.freshUntil) return entry.value;
  const value = loader();
  store.set(key, { value, freshUntil: now + ttlMs, staleUntil: now + ttlMs, inflight: null } as Entry<unknown>);
  return value;
}

export function invalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
