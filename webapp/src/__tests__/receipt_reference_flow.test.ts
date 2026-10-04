import { describe, it, expect } from 'vitest';
import { receiptHasImage, receiptIsInline } from '../admin/adminApi.ts';
import { translations } from '../i18n.ts';

describe('receiptHasImage (admin slip-viewer gate)', () => {
  it('is false when there is no receipt at all', () => {
    expect(receiptHasImage(null)).toBe(false);
    expect(receiptHasImage(undefined)).toBe(false);
    expect(receiptHasImage('')).toBe(false);
  });

  it('is false for the reference-only sentinel written by POST /api/receipt', () => {
    // A buyer who pasted only a transaction reference still gets a truthy
    // receipt_file_id, but there is no image behind it.
    expect(receiptHasImage('web_receipt_upload')).toBe(false);
  });

  it('is false for the synthetic SMS-verified identifier', () => {
    expect(receiptHasImage('sms:FT26090123456789')).toBe(false);
  });

  it('is false for the in-memory base64 fallback used when disk persistence fails', () => {
    expect(receiptHasImage('base64_upload_1758000000000')).toBe(false);
  });

  it('is true for a real stored filename', () => {
    expect(receiptHasImage('ord-1758000000000-ab12cd34.jpg')).toBe(true);
  });

  it('is true for a legacy inline data-URL receipt', () => {
    expect(receiptHasImage('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(receiptIsInline('data:image/jpeg;base64,AAAA')).toBe(true);
  });

  it('keeps receiptIsInline false for real stored files', () => {
    expect(receiptIsInline('ord-1758000000000-ab12cd34.jpg')).toBe(false);
  });
});

describe('Mini App receipt copy parity with the Telegram bot', () => {
  // translations values are mixed (most are string, a few are string[]), so read
  // only the string keys we assert on.
  const en = translations.en as unknown as Record<string, string>;
  const am = translations.am as unknown as Record<string, string>;

  it('offers the transaction reference as a first-class field in both languages', () => {
    expect(en.receiptRefLabel).toBeTruthy();
    expect(am.receiptRefLabel).toBeTruthy();
    expect(en.receiptRefHint).toBeTruthy();
    expect(am.receiptRefHint).toBeTruthy();
  });

  it('tells buyers they can paste the SMS or just the reference number', () => {
    // Matches the Telegram bot guidance so both channels offer the same path.
    expect(en.receiptRefHint.toLowerCase()).toContain('sms');
    expect(en.receiptRefHint.toLowerCase()).toContain('reference');
  });

  it('no longer frames the image upload as mandatory', () => {
    expect(en.uploadReceiptSub.toLowerCase()).toContain('optional');
    expect(am.uploadReceiptSub).toContain('አማራጭ');
  });

  it('shows a reference-shaped placeholder rather than generic note copy', () => {
    expect(en.paymentNotePlaceholder).toMatch(/FT\d+/);
    expect(am.paymentNotePlaceholder).toMatch(/FT\d+/);
  });
});
