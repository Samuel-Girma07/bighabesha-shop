/** Centralized haptic feedback kit — no-ops outside Telegram. */

function impact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  } catch { /* non-Telegram context */ }
}

export const haptic = {
  select(): void {
    try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(); } catch {}
  },
  tap(): void {
    impact('light');
  },
  success(): void {
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success'); } catch {}
  },
  error(): void {
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error'); } catch {}
  },
  warn(): void {
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning'); } catch {}
  },
};
