import { describe, it, expect } from 'vitest';
import { t } from '../src/i18n/index.js';

describe('i18n Localization Module', () => {
  it('translates simple and nested keys accurately', () => {
    expect(t('en', 'menu.shop')).toBe('🛍 Browse Shop');
    expect(t('en', 'health.ok')).toBe('✅ Bighabesha Shop Bot is running healthy and responsive!');
  });

  it('interpolates template variables correctly', () => {
    const support = t('en', 'support.text', { supportUsername: 'Vweah' });
    expect(support).toContain('@Vweah');

    const gemini = t('en', 'gemini.default_instructions', {
      link: 'https://gemini.google.com/redeem/abc123xyz',
      supportUsername: 'Vweah',
    });
    expect(gemini).toContain('https://gemini.google.com/redeem/abc123xyz');
    expect(gemini).toContain('@Vweah');
  });

  it('falls back to English if the key exists in English but requested language is unknown', () => {
    expect(t('am', 'menu.orders')).toBe('📦 My Orders');
  });

  it('returns the raw key if the key is not found in any translation dictionary', () => {
    expect(t('en', 'nonexistent.key.path')).toBe('nonexistent.key.path');
  });
});
