/**
 * Cross-device preference persistence via Telegram CloudStorage with a
 * localStorage fallback (standalone browser / older clients).
 */

export interface UserPrefs {
  language?: 'en' | 'am';
  currency?: 'ETB' | 'USD' | 'TON';
}

const KEY = 'bighabesha_prefs_v1';

function cloud(): { setItem: (k: string, v: string, cb?: (e: unknown, ok: boolean) => void) => void; getItem: (k: string, cb: (e: unknown, v: string | null) => void) => void; removeItem: (k: string, cb?: (e: unknown, ok: boolean) => void) => void } | null {
  try {
    return window.Telegram?.WebApp?.CloudStorage ?? null;
  } catch {
    return null;
  }
}

export function loadPrefs(): Promise<UserPrefs> {
  return new Promise((resolve) => {
    const storage = cloud();
    if (!storage) {
      try {
        resolve(JSON.parse(localStorage.getItem(KEY) || '{}'));
      } catch {
        resolve({});
      }
      return;
    }
    storage.getItem(KEY, (_err: unknown, value: string | null) => {
      if (value) {
        try {
          resolve(JSON.parse(value));
          return;
        } catch { /* fall through */ }
      }
      // Fallback to local mirror
      try {
        resolve(JSON.parse(localStorage.getItem(KEY) || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

export function savePrefs(prefs: UserPrefs): void {
  const serialized = JSON.stringify({ ...loadPrefsSync(), ...prefs });
  try {
    localStorage.setItem(KEY, serialized);
  } catch { /* non-fatal */ }
  const storage = cloud();
  if (storage) {
    try {
      storage.setItem(KEY, serialized);
    } catch { /* non-fatal */ }
  }
}

/** Synchronous best-effort read from the local mirror only. */
export function loadPrefsSync(): UserPrefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
