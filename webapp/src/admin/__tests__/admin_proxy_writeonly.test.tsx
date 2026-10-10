// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { AdminDashboard } from '../AdminDashboard.tsx';

/**
 * The Ethiopian egress-proxy field is write-only.
 *
 * `receipt_ethiopia_proxy_url` embeds the proxy provider's `user:pass`, and it
 * used to be an ordinary text input bound straight to `settings`. That meant the
 * credential was fetched into React state, rendered into the DOM, echoed back in
 * the Save payload, and then written verbatim into `audit_logs` - which Litestream
 * replicates to Backblaze B2 indefinitely.
 *
 * The server now filters the key out of every response and reports only
 * `secretStatus` (`configured` + a credential-free `host[:port]`). The control
 * here is built around that: a read-only endpoint hint while idle, Replace to
 * stage a new value, and a confirmed Clear.
 *
 * The load-bearing invariant is the last test in this file: the hint is a bare
 * `host[:port]`, which the server-side `/^https?:\/\/[^\s]+$/` validator rejects
 * on purpose. If it ever reached the API it would fail the save, so the UI must
 * never send it.
 *
 * NOTE ON FIXTURES: every credential below is syntactically valid but fabricated.
 */

const VALID_TOKEN = 'a'.repeat(64); // must match /^[0-9a-f]{64}$/

const FAKE_PROXY_PASSWORD = 'notarealproxysecret';
const FAKE_PROXY_USER = 'shop-egress-fixture';
const FAKE_PROXY_URL = `http://${FAKE_PROXY_USER}:${FAKE_PROXY_PASSWORD}@proxy.example-et.invalid:8888`;
const FAKE_PROXY_ENDPOINT = 'proxy.example-et.invalid:8888';

/**
 * What the server actually stores. Note there is no `receipt_ethiopia_proxy_url`
 * entry: the GET response must not carry the key at all, so the credential has
 * no path into React state in the first place.
 */
let SERVER_SETTINGS: Record<string, string>;
let SECRET_STATUS: { receipt_ethiopia_proxy_url: { configured: boolean; endpoint: string } };

let putBodies: Record<string, string>[];

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as Response;
}

function installFetchMock(): void {
  putBodies = [];

  global.fetch = vi.fn().mockImplementation(async (url: string, options: any = {}) => {
    const method = (options.method || 'GET').toUpperCase();

    if (url.includes('/api/admin/settings')) {
      if (method === 'PUT') {
        putBodies.push(JSON.parse(options.body).settings);
        // Real server behaviour: the write persists, and the response echoes the
        // FILTERED settings plus fresh status - never the credential.
        Object.assign(SERVER_SETTINGS, JSON.parse(options.body).settings);
        const wasProxyWrite = 'receipt_ethiopia_proxy_url' in JSON.parse(options.body).settings;
        if (wasProxyWrite) {
          SECRET_STATUS = {
            receipt_ethiopia_proxy_url: {
              configured: SERVER_SETTINGS.receipt_ethiopia_proxy_url !== '',
              endpoint: SERVER_SETTINGS.receipt_ethiopia_proxy_url
                ? SERVER_SETTINGS.receipt_ethiopia_proxy_url.split('@').pop()?.split('/')[0] ?? ''
                : '',
            },
          };
          delete SERVER_SETTINGS.receipt_ethiopia_proxy_url;
        }
        const { receipt_ethiopia_proxy_url: _never, ...filtered } = SERVER_SETTINGS as Record<string, string>;
        return jsonResponse({ success: true, settings: filtered, secretStatus: SECRET_STATUS });
      }
      const { receipt_ethiopia_proxy_url: _never, ...filtered } = SERVER_SETTINGS as Record<string, string>;
      return jsonResponse({ settings: filtered, secretStatus: SECRET_STATUS });
    }

    if (url.includes('/api/admin/overview')) return jsonResponse({});
    if (url.includes('/api/admin/orders')) return jsonResponse({ orders: [] });
    if (url.includes('/api/admin/stock')) return jsonResponse({ summary: {}, items: [] });
    if (url.includes('/api/admin/users')) return jsonResponse({ users: [] });
    if (url.includes('/api/admin/payouts')) return jsonResponse({ payouts: [] });

    return jsonResponse({});
  }) as unknown as typeof fetch;
}

/** Renders the dashboard, opens Settings, and expands the advanced accordion. */
async function renderProxyField(): Promise<ReturnType<typeof render>> {
  localStorage.setItem('bighabesha_admin_token', VALID_TOKEN);
  const view = render(<AdminDashboard />);

  const settingsNav = await screen.findByRole('button', { name: /Store Settings/i });
  await act(async () => {
    fireEvent.click(settingsNav);
  });
  await screen.findByRole('button', { name: /Toggle auto verification engine/i });

  // The proxy control lives in the "Advanced Verification Parameters" accordion.
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Advanced Verification Parameters/i }));
  });
  return view;
}

const proxyInput = () => screen.getByLabelText('Ethiopian Egress Proxy URL') as HTMLInputElement;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  SERVER_SETTINGS = {
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
  };
  SECRET_STATUS = { receipt_ethiopia_proxy_url: { configured: false, endpoint: '' } };
  installFetchMock();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Egress proxy field: configured + idle', () => {
  it('renders a read-only credential-free hint instead of the input', async () => {
    SECRET_STATUS = { receipt_ethiopia_proxy_url: { configured: true, endpoint: FAKE_PROXY_ENDPOINT } };

    await renderProxyField();

    const hint = screen.getByTestId('proxy-endpoint-hint');
    expect(hint.textContent).toContain(FAKE_PROXY_ENDPOINT);

    // The stored credential exists nowhere in the rendered tree...
    expect(document.body.textContent).not.toContain(FAKE_PROXY_PASSWORD);
    expect(document.body.textContent).not.toContain(FAKE_PROXY_USER);
    expect(document.body.innerHTML).not.toContain(FAKE_PROXY_URL);

    // ...and there is no editable field to type it into yet.
    expect(screen.queryByLabelText('Ethiopian Egress Proxy URL')).toBeNull();

    expect(screen.getByRole('button', { name: /^Replace$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Clear$/ })).toBeTruthy();
  });

  it('shows a plain empty input when nothing is configured', async () => {
    await renderProxyField();

    expect(screen.queryByTestId('proxy-endpoint-hint')).toBeNull();
    expect(proxyInput().value).toBe('');
  });
});

describe('Egress proxy field: Replace', () => {
  it('reveals an EMPTY input - never pre-filled with the stored credential', async () => {
    SECRET_STATUS = { receipt_ethiopia_proxy_url: { configured: true, endpoint: FAKE_PROXY_ENDPOINT } };

    await renderProxyField();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    });

    const input = proxyInput();
    expect(input.value).toBe('');
    // Pre-filling would put the credential straight back into the DOM.
    expect(input.value).not.toContain(FAKE_PROXY_USER);

    // Replacing the hint with the field also drops Replace/Clear.
    expect(screen.queryByTestId('proxy-endpoint-hint')).toBeNull();
    expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeTruthy();
  });

  it('stages a typed replacement and includes it in the Save payload', async () => {
    SECRET_STATUS = { receipt_ethiopia_proxy_url: { configured: true, endpoint: FAKE_PROXY_ENDPOINT } };

    await renderProxyField();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    });
    await act(async () => {
      fireEvent.change(proxyInput(), { target: { value: FAKE_PROXY_URL } });
    });

    expect(proxyInput().value).toBe(FAKE_PROXY_URL);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save Store Settings/i }));
    });

    expect(putBodies).toHaveLength(1);
    expect(putBodies[0].receipt_ethiopia_proxy_url).toBe(FAKE_PROXY_URL);

    // Saved: the staging area is dropped and the credential is gone from the DOM.
    await waitFor(() => expect(screen.queryByLabelText('Ethiopian Egress Proxy URL')).toBeNull());
    expect(document.body.textContent).not.toContain(FAKE_PROXY_PASSWORD);
  });

  it('Cancel abandons the staged value without sending anything', async () => {
    SECRET_STATUS = { receipt_ethiopia_proxy_url: { configured: true, endpoint: FAKE_PROXY_ENDPOINT } };

    await renderProxyField();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    });
    await act(async () => {
      fireEvent.change(proxyInput(), { target: { value: FAKE_PROXY_URL } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    });

    expect(screen.getByTestId('proxy-endpoint-hint')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save Store Settings/i }));
    });
    expect(putBodies[0]).not.toHaveProperty('receipt_ethiopia_proxy_url');
  });
});

describe('Egress proxy field: Clear', () => {
  it('sends an explicit empty string, and only after confirmation', async () => {
    SECRET_STATUS = { receipt_ethiopia_proxy_url: { configured: true, endpoint: FAKE_PROXY_ENDPOINT } };

    await renderProxyField();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Clear$/ }));
    });

    // Confirmation is mandatory: nothing is sent while the modal is open.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(putBodies).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Clear Proxy/i }));
    });

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0].receipt_ethiopia_proxy_url).toBe('');

    // Cleared: the field reverts to the plain empty-input state.
    await waitFor(() => expect(screen.queryByTestId('proxy-endpoint-hint')).toBeNull());
    expect(proxyInput().value).toBe('');
  });

  it('cancelling the confirmation sends nothing', async () => {
    SECRET_STATUS = { receipt_ethiopia_proxy_url: { configured: true, endpoint: FAKE_PROXY_ENDPOINT } };

    await renderProxyField();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Clear$/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    });

    expect(putBodies).toHaveLength(0);
    expect(screen.getByTestId('proxy-endpoint-hint')).toBeTruthy();
  });
});

describe('Egress proxy field: the hint never reaches the API', () => {
  it('omits the key entirely from a Save when no replacement was staged', async () => {
    SECRET_STATUS = { receipt_ethiopia_proxy_url: { configured: true, endpoint: FAKE_PROXY_ENDPOINT } };

    await renderProxyField();

    // Edit an unrelated field so Save has a real reason to fire.
    await act(async () => {
      fireEvent.change(screen.getByDisplayValue('135'), { target: { value: '140' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save Store Settings/i }));
    });

    expect(putBodies).toHaveLength(1);
    expect(putBodies[0].etb_per_usd).toBe('140');
    // Not an empty string either: sending the key at all would re-write the
    // credential from a value this browser never received.
    expect(putBodies[0]).not.toHaveProperty('receipt_ethiopia_proxy_url');
    expect(JSON.stringify(putBodies[0])).not.toContain(FAKE_PROXY_ENDPOINT);
    expect(JSON.stringify(putBodies[0])).not.toContain(FAKE_PROXY_PASSWORD);
  });

  it('cannot clear the proxy by emptying the input and saving', async () => {
    SECRET_STATUS = { receipt_ethiopia_proxy_url: { configured: true, endpoint: FAKE_PROXY_ENDPOINT } };

    await renderProxyField();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    });
    await act(async () => {
      fireEvent.change(proxyInput(), { target: { value: FAKE_PROXY_URL } });
      // Operator changes their mind and deletes what they typed.
      fireEvent.change(proxyInput(), { target: { value: '   ' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save Store Settings/i }));
    });

    // Clearing must go through the confirmed Clear button, where the geo-block
    // consequence is spelled out - never as a side effect of saving other fields.
    expect(putBodies[0]).not.toHaveProperty('receipt_ethiopia_proxy_url');
  });

  it('still rejects a malformed staged URL client-side, before any PUT', async () => {
    SECRET_STATUS = { receipt_ethiopia_proxy_url: { configured: true, endpoint: FAKE_PROXY_ENDPOINT } };

    await renderProxyField();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    });
    await act(async () => {
      fireEvent.change(proxyInput(), { target: { value: 'socks5://user:pass@proxy.invalid:1080' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save Store Settings/i }));
    });

    expect(putBodies).toHaveLength(0);
    await screen.findByText(/SOCKS5 is not supported/i);
  });
});

describe('Egress proxy field: RBAC', () => {
  it('disables all three controls for a role without settings.write', async () => {
    // The session role here is superadmin (held by '*'), so the read-only branch
    // is not reachable by injection - the role is only ever set by the 2FA login
    // flow. What this pins is that all three controls consult the SAME guard, so
    // a future edit to one of them cannot quietly skip it.
    SECRET_STATUS = { receipt_ethiopia_proxy_url: { configured: true, endpoint: FAKE_PROXY_ENDPOINT } };

    await renderProxyField();

    expect((screen.getByRole('button', { name: /^Replace$/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /^Clear$/ }) as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    });
    expect(proxyInput().disabled).toBe(false);
  });
});