// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { AdminDashboard } from '../AdminDashboard.tsx';

/**
 * Settings-tab persistence behaviour.
 *
 * Two defects are covered here:
 *
 *  1. The `receipt_auto_verify_enabled` master switch only mutated React state.
 *     Nothing was written until the operator scrolled to the bottom of the tab
 *     and pressed "Save Store Settings" — so flipping live bank-portal traffic
 *     looked like a no-op.
 *  2. The 10s live sync called `setSettings(...)` unconditionally, so an unsaved
 *     edit reverted within ten seconds and read as "the server rejected my save".
 *
 * The switch now persists itself (optimistically, reverting on failure) and the
 * live sync leaves the form alone while it holds unsaved edits.
 */

const VALID_TOKEN = 'a'.repeat(64); // must match /^[0-9a-f]{64}$/

const SERVER_SETTINGS: Record<string, string> = {
  receipt_auto_verify_enabled: '0',
  cbe_account: '1000123456789',
  cbe_name: 'Bighabesha Shop',
  telebirr_account: '0911223344',
  abyssinia_account: '1234567890',
  etb_per_usd: '135',
  receipt_cbe_port: '100',
  receipt_circuit_breaker_threshold: '5',
  receipt_circuit_breaker_cooldown_sec: '60',
  receipt_recency_before_mins: '120',
  receipt_recency_after_mins: '120',
  receipt_ethiopia_proxy_url: '',
};

interface FetchLog {
  get: Record<string, number>;
  putBodies: Record<string, string>[];
}

let log: FetchLog;
/** Flips the next settings PUT to a 400 so the optimistic-write path is exercised. */
let putFails: boolean;
/** When set, the settings PUT blocks on this promise so in-flight state is testable. */
let putGate: Promise<void> | null = null;

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as Response;
}

function installFetchMock(): void {
  log = { get: {}, putBodies: [] };

  global.fetch = vi.fn().mockImplementation(async (url: string, options: any = {}) => {
    const method = (options.method || 'GET').toUpperCase();

    if (url.includes('/api/admin/settings')) {
      if (method === 'PUT') {
        log.putBodies.push(JSON.parse(options.body).settings);
        if (putGate) await putGate;
        if (putFails) {
          return jsonResponse({ error: 'Settings validation failed: cbe_account must be exactly 13 digits' }, false);
        }
        Object.assign(SERVER_SETTINGS, JSON.parse(options.body).settings);
        return jsonResponse({ success: true, settings: SERVER_SETTINGS });
      }
      log.get.settings = (log.get.settings || 0) + 1;
      return jsonResponse({ settings: { ...SERVER_SETTINGS } });
    }

    if (url.includes('/api/admin/overview')) {
      log.get.overview = (log.get.overview || 0) + 1;
      return jsonResponse({});
    }
    if (url.includes('/api/admin/orders')) {
      log.get.orders = (log.get.orders || 0) + 1;
      return jsonResponse({ orders: [] });
    }
    if (url.includes('/api/admin/stock')) {
      log.get.stock = (log.get.stock || 0) + 1;
      return jsonResponse({ summary: {}, items: [] });
    }
    if (url.includes('/api/admin/users')) {
      log.get.users = (log.get.users || 0) + 1;
      return jsonResponse({ users: [] });
    }
    if (url.includes('/api/admin/payouts')) {
      log.get.payouts = (log.get.payouts || 0) + 1;
      return jsonResponse({ payouts: [] });
    }

    return jsonResponse({});
  }) as unknown as typeof fetch;
}

/** Renders the dashboard with a live session and opens the Settings tab. */
async function renderSettingsTab(): Promise<ReturnType<typeof render>> {
  localStorage.setItem('bighabesha_admin_token', VALID_TOKEN);
  const view = render(<AdminDashboard />);

  const settingsNav = await screen.findByRole('button', { name: /Store Settings/i });
  await act(async () => {
    fireEvent.click(settingsNav);
  });

  await screen.findByRole('button', { name: /Toggle auto verification engine/i });
  return view;
}

beforeEach(() => {
  // Silences React's "not configured to support act(...)" warning for awaits
  // that resolve outside RTL's own act() wrapper.
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  putFails = false;
  putGate = null;
  Object.assign(SERVER_SETTINGS, {
    receipt_auto_verify_enabled: '0',
    cbe_account: '1000123456789',
    etb_per_usd: '135',
  });
  installFetchMock();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Settings tab: the verification master switch persists immediately', () => {
  it('writes the new engine state on click instead of waiting for the Save button', async () => {
    await renderSettingsTab();

    expect(screen.getByText('⏸️ Paused')).toBeTruthy();
    expect(log.putBodies).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Toggle auto verification engine/i }));
    });

    expect(log.putBodies).toHaveLength(1);
    expect(log.putBodies[0].receipt_auto_verify_enabled).toBe('1');
    expect(SERVER_SETTINGS.receipt_auto_verify_enabled).toBe('1');

    // Optimistic state is confirmed by the server: the engine reads as active.
    await screen.findByText('🟢 Active');
    expect(screen.getByText('Automated verification enabled.')).toBeTruthy();
  });

  it('rolls the switch back and surfaces the error when the write fails', async () => {
    await renderSettingsTab();
    putFails = true;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Toggle auto verification engine/i }));
    });

    // The UI must not claim a state the server does not hold.
    await screen.findByText('⏸️ Paused');
    expect(screen.getByText(/Settings validation failed/)).toBeTruthy();
    expect(SERVER_SETTINGS.receipt_auto_verify_enabled).toBe('0');
  });

  it('leaves the switch enabled for a settings.write role and advertises the immediate save', async () => {
    await renderSettingsTab();

    const toggle = screen.getByRole('button', { name: /Toggle auto verification engine/i }) as HTMLButtonElement;
    // The session role here is superadmin, which holds '*'. The read-only branch
    // of this same `canSee('settings.write')` expression is what keeps the switch
    // `disabled`; a role-injection test is not reachable here because the role
    // is only ever set by the 2FA login flow (see the rules-of-hooks finding).
    expect(toggle.disabled).toBe(false);
    expect(toggle.title).toContain('saves immediately');
  });

  it('ignores repeat clicks while the optimistic write is still in flight', async () => {
    let releasePut: () => void = () => {};
    putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });

    await renderSettingsTab();

    const toggle = screen.getByRole('button', { name: /Toggle auto verification engine/i });
    await act(async () => {
      fireEvent.click(toggle);
    });
    // In flight: locked, so a double-click cannot flip it back and forth.
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(log.putBodies).toHaveLength(1);

    await act(async () => {
      releasePut();
      await putGate;
    });
    await screen.findByText('Automated verification enabled.');
    expect((screen.getByRole('button', { name: /Toggle auto verification engine/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Settings tab: unsaved edits survive the 10s live sync', () => {
  it('does not let a background refresh clobber the form, but keeps other tabs refreshing', async () => {
    // Only the interval is faked: RTL's waitFor still needs real setTimeout.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    await renderSettingsTab();

    const accountInput = screen.getByPlaceholderText('e.g. 1000123456789') as HTMLInputElement;
    const etbInput = screen.getByDisplayValue('135') as HTMLInputElement;

    const ordersBefore = log.get.orders || 0;
    const settingsBefore = log.get.settings || 0;

    await act(async () => {
      fireEvent.change(accountInput, { target: { value: '1000999888777' } });
      fireEvent.change(etbInput, { target: { value: '140' } });
    });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    // Settings were re-fetched, but the operator's draft survived...
    expect(log.get.settings).toBeGreaterThan(settingsBefore);
    expect((screen.getByPlaceholderText('e.g. 1000123456789') as HTMLInputElement).value).toBe('1000999888777');
    expect((screen.getByDisplayValue('140') as HTMLInputElement).value).toBe('140');

    // ...while every other dataset kept its 10s refresh cadence.
    expect(log.get.orders).toBeGreaterThan(ordersBefore);

    // Leaving the tab drops the guard so live syncing resumes for settings too.
    // (Both the mobile quick-tab and the sidebar expose an "Overview" button.)
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^Overview$/i })[0]);
    });
    const settingsAfterLeave = log.get.settings || 0;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(log.get.settings).toBeGreaterThan(settingsAfterLeave);
  });

  it('clears the unsaved badge once the form is persisted', async () => {
    await renderSettingsTab();

    const accountInput = screen.getByPlaceholderText('e.g. 1000123456789') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(accountInput, { target: { value: '1000999888777' } });
    });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save Store Settings/i }));
    });

    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect(SERVER_SETTINGS.cbe_account).toBe('1000999888777');
    expect(screen.getByText('Store settings updated successfully')).toBeTruthy();
  });
});
