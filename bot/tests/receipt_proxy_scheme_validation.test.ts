import { describe, it, expect } from 'vitest';
import { validateVerificationSettings } from '../src/services/settings.service.js';

/**
 * P1 guard: the settings validator used to accept `socks5://` proxy URIs.
 *
 * `https-proxy-agent@9.1.0` does not reject a SOCKS5 URI — verified
 * empirically: it constructs successfully and then speaks HTTP CONNECT to the
 * SOCKS5 port, which fails as a broken tunnel. Accepting the scheme here meant
 * a misconfiguration only surfaced at request time as an opaque failure,
 * instead of as an actionable configuration error at save time.
 */

function validateProxy(url: string) {
  return validateVerificationSettings({ receipt_ethiopia_proxy_url: url });
}

describe('FIX-4: proxy scheme validation', () => {
  it('accepts an empty value (direct egress)', () => {
    const result = validateProxy('');
    expect(result.isValid).toBe(true);
  });

  it('accepts an http proxy URI', () => {
    expect(validateProxy('http://user:pass@proxy.et:8888').isValid).toBe(true);
  });

  it('accepts an https proxy URI', () => {
    expect(validateProxy('https://user:pass@proxy.et:8888').isValid).toBe(true);
  });

  it('rejects a socks5 proxy URI', () => {
    const result = validateProxy('socks5://user:pass@proxy.et:1080');
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/SOCKS5 is not supported/i);
  });

  it('rejects socks5 regardless of case', () => {
    expect(validateProxy('SOCKS5://proxy.et:1080').isValid).toBe(false);
    expect(validateProxy('Socks5://proxy.et:1080').isValid).toBe(false);
  });

  it('rejects other unsupported schemes', () => {
    for (const url of ['ftp://proxy.et:21', 'socks4://proxy.et:1080', 'ssh://proxy.et:22']) {
      expect(validateProxy(url).isValid).toBe(false);
    }
  });

  it('rejects a schemeless or malformed value', () => {
    for (const url of ['proxy.et:8888', 'not a uri', 'http://']) {
      expect(validateProxy(url).isValid).toBe(false);
    }
  });

  it('does not leak proxy credentials into the validation error', () => {
    const result = validateProxy('socks5://operator:s3cret-value@proxy.et:1080');
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).not.toContain('s3cret-value');
    expect(result.errors.join(' ')).not.toContain('operator');
  });
});