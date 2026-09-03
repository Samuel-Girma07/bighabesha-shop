import { describe, it, expect, vi } from 'vitest';
import { computeStarsTotal, formatEtb, translationKeyPaths } from '../utils.js';
import { translations } from '../i18n.js';
import { createOrderApi } from '../api.js';

describe('computeStarsTotal (client mirror of server pricing)', () => {
  it('rounds up fractional totals like the server', () => {
    expect(computeStarsTotal(500, 2.5)).toBe(1250);
    expect(computeStarsTotal(3, 2.5)).toBe(8); // 7.5 -> 8
    expect(computeStarsTotal(7, 1.1)).toBe(8); // 7.7 -> 8
  });

  it('falls back to the default rate of 2.5 for invalid rates', () => {
    expect(computeStarsTotal(100, 0)).toBe(250);
    expect(computeStarsTotal(100, -1)).toBe(250);
    expect(computeStarsTotal(100, NaN)).toBe(250);
  });

  it('rejects invalid star amounts', () => {
    expect(() => computeStarsTotal(0, 2.5)).toThrow();
    expect(() => computeStarsTotal(-5, 2.5)).toThrow();
    expect(() => computeStarsTotal(10.5, 2.5)).toThrow();
    expect(() => computeStarsTotal(NaN, 2.5)).toThrow();
  });
});

describe('formatEtb', () => {
  it('formats with thousands separators and ETB suffix', () => {
    expect(formatEtb(1250)).toBe('1,250 ETB');
    expect(formatEtb(1500)).toBe('1,500 ETB');
    expect(formatEtb(0)).toBe('0 ETB');
  });

  it('handles invalid input defensively', () => {
    expect(formatEtb(-10)).toBe('0 ETB');
    expect(formatEtb(NaN)).toBe('0 ETB');
  });
});

describe('i18n translation completeness', () => {
  it('English and Amharic dictionaries expose identical key sets', () => {
    const en = translationKeyPaths(translations.en);
    const am = translationKeyPaths(translations.am);

    const missingInAm = en.filter((k) => !am.includes(k));
    const missingInEn = am.filter((k) => !en.includes(k));

    expect(missingInAm).toEqual([]);
    expect(missingInEn).toEqual([]);
  });

  it('critical storefront keys exist and are non-empty strings', () => {
    for (const key of ['bootstrapError', 'brandName', 'buyNow', 'myOrders', 'support']) {
      const en = (translations.en as any)[key];
      const am = (translations.am as any)[key];
      expect(typeof en).toBe('string');
      expect(en.length).toBeGreaterThan(0);
      expect(typeof am).toBe('string');
      expect(am.length).toBeGreaterThan(0);
    }
  });
});

describe('createOrderApi TMA gifting and payment rails', () => {
  it('sends targetUsername and selected payment rail in JSON payload', async () => {
    let capturedUrl = '';
    let capturedOptions: any = null;

    const mockFetch = vi.fn().mockImplementation(async (url: string, options: any) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        json: async () => ({
          order: {
            id: 'ord_test123',
            product_id: 'telegram_premium',
            variant_id: 'tg_prem_3m',
            payment_rail: 'cbe',
            target_username: 'friend_username',
            status: 'awaiting_payment',
          },
        }),
      };
    });

    vi.stubGlobal('fetch', mockFetch);

    const res = await createOrderApi({
      productId: 'telegram_premium',
      variantId: 'tg_prem_3m',
      paymentRail: 'cbe',
      targetUsername: 'friend_username',
    });

    expect(capturedUrl).toContain('/api/orders');
    expect(capturedOptions.method).toBe('POST');
    const parsedBody = JSON.parse(capturedOptions.body);
    expect(parsedBody.productId).toBe('telegram_premium');
    expect(parsedBody.variantId).toBe('tg_prem_3m');
    expect(parsedBody.paymentRail).toBe('cbe');
    expect(parsedBody.targetUsername).toBe('friend_username');
    expect(res.order.id).toBe('ord_test123');

    vi.unstubAllGlobals();
  });

  it('omits targetUsername from payload when undefined or empty', async () => {
    let capturedBody: any = null;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, options: any) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ order: { id: 'ord_stock456' } }),
      };
    });

    vi.stubGlobal('fetch', mockFetch);

    await createOrderApi({
      productId: 'gemini_pro_18m',
      variantId: 'gemini_pro_18m_default',
      paymentRail: 'abyssinia',
    });

    expect(capturedBody.productId).toBe('gemini_pro_18m');
    expect(capturedBody.paymentRail).toBe('abyssinia');
    expect(capturedBody.targetUsername).toBeUndefined();

    vi.unstubAllGlobals();
  });
});

