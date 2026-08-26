import { describe, it, expect } from 'vitest';
import { computeStarsTotal, formatEtb, translationKeyPaths } from '../utils.js';
import { translations } from '../i18n.js';

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
