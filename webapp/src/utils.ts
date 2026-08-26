/**
 * Client-side presentation helpers. These NEVER decide what a customer pays —
 * the server recomputes all prices authoritatively — they only mirror the
 * server's math so the UI matches the order that will be created.
 */

/** Mirrors pricing.service: ceil(stars × rate), with sane fallbacks/guards. */
export function computeStarsTotal(stars: number, etbPerStar: number): number {
  if (!Number.isFinite(stars) || !Number.isInteger(stars) || stars <= 0) {
    throw new Error('Stars must be a positive whole number.');
  }
  const rate = Number.isFinite(etbPerStar) && etbPerStar > 0 ? etbPerStar : 2.5;
  return Math.ceil(stars * rate);
}

/** Formats ETB amounts as "1,250 ETB". */
export function formatEtb(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return '0 ETB';
  return `${Math.round(amount).toLocaleString('en-US')} ETB`;
}

export type DisplayCurrency = 'ETB' | 'USD' | 'TON';

/**
 * DISPLAY-ONLY currency conversion. The server always charges ETB — this
 * helper only mirrors what the buyer will roughly pay, for UX clarity.
 */
export function convertDisplay(
  amountEtb: number,
  currency: DisplayCurrency,
  rates: { etbPerUsd: number; tonUsd: number; marginPct?: number }
): { value: number; symbol: string } {
  const safe = Number.isFinite(amountEtb) && amountEtb > 0 ? amountEtb : 0;
  if (currency === 'ETB') return { value: safe, symbol: 'ETB' };

  const etbPerUsd = Number.isFinite(rates.etbPerUsd) && rates.etbPerUsd > 0 ? rates.etbPerUsd : 135;
  const tonUsd = Number.isFinite(rates.tonUsd) && rates.tonUsd > 0 ? rates.tonUsd : 3.5;

  if (currency === 'USD') {
    return { value: Math.round((safe / etbPerUsd) * 100) / 100, symbol: '$' };
  }
  // TON: ETB → USD (+margin, matching the crypto quote) → TON
  const usd = safe / etbPerUsd;
  const ton = usd / tonUsd;
  return { value: Math.round(ton * 10000) / 10000, symbol: 'TON' };
}

/** Renders a converted amount with sensible precision per currency. */
export function formatMoney(amountEtb: number, currency: DisplayCurrency, rates: { etbPerUsd: number; tonUsd: number }): string {
  const { value, symbol } = convertDisplay(amountEtb, currency, rates);
  if (currency === 'ETB') return formatEtb(value);
  if (currency === 'USD') return `$${value.toFixed(2)}`;
  return `${value.toFixed(2)} ${symbol}`;
}

/** Recursively collects leaf-key paths of a translations object. */
export function translationKeyPaths(obj: Record<string, unknown>, prefix: string = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') {
      keys.push(...translationKeyPaths(v as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}
