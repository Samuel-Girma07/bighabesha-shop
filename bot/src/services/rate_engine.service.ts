import { getNumericSetting } from './settings.service.js';
import { logger } from '../logger/index.js';
import { cached, invalidate } from './cache.service.js';
import { fetchJson } from '../lib/http.js';

export interface CryptoPriceCache {
  tonUsd: number;
  usdtUsd: number;
  lastFetchedAt: number;
}

// Last-known-good prices, kept outside the shared cache so a total upstream
// outage still yields a usable quote instead of throwing at checkout.
let priceCache: CryptoPriceCache = {
  tonUsd: 3.50, // Realistic market baseline
  usdtUsd: 1.0,
  lastFetchedAt: Date.now(),
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PRICE_STALE_MS = 10 * 60 * 1000;
const PRICE_CACHE_KEY = 'coingecko:simple-price';
const USD_ETB_CACHE_KEY = 'erapi:usd-etb';

export function getFallbackTonUsd(): number {
  return getNumericSetting('fallback_ton_usd', 3.50);
}

export async function fetchCoinGeckoPrices(_forceRefresh = false): Promise<{ tonUsd: number; usdtUsd: number }> {
  const tonUsd = priceCache.tonUsd || getFallbackTonUsd();
  const usdtUsd = priceCache.usdtUsd || 1.0;
  return { tonUsd, usdtUsd };
}

export async function fetchLiveUSDToETB(): Promise<number | null> {
  try {
    return await cached(USD_ETB_CACHE_KEY, { ttlMs: 15 * 60_000, staleMs: 60 * 60_000 }, async () => {
      const data = await fetchJson<{ rates?: { ETB?: number } }>('https://open.er-api.com/v6/latest/USD', {
        timeoutMs: 6000,
        attempts: 2,
        retryOn5xx: true,
        breakerKey: 'open-er-api',
      });
      const etb = Number(data.rates?.ETB);
      if (!Number.isFinite(etb) || etb <= 0) throw new Error('open.er-api returned no usable ETB rate');
      logger.info({ liveEtbPerUsd: etb }, 'Fetched live USD to ETB exchange rate');
      return etb;
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch live USD to ETB rate from open.er-api.com');
    return null;
  }
}


export function calculateCryptoQuote(
  priceETB: number,
  coinPriceUsd: number,
  customParams?: { etbPerUsd?: number; marginPct?: number }
): { usdAmountWithMargin: number; cryptoAmount: number } {
  const etbPerUsd = customParams?.etbPerUsd ?? getNumericSetting('etb_per_usd', 135);
  const marginPct = customParams?.marginPct ?? getNumericSetting('margin_pct', 5);

  const safeEtbPerUsd = etbPerUsd <= 0 ? 135 : etbPerUsd;
  const safeMarginPct = marginPct < 0 ? 0 : marginPct;
  const safeCoinPrice = coinPriceUsd <= 0 ? 1 : coinPriceUsd;

  // Base USD price
  const baseUsd = priceETB / safeEtbPerUsd;
  // USD price with margin
  const usdAmountWithMargin = baseUsd * (1 + safeMarginPct / 100);

  // Crypto coins needed: usdAmountWithMargin / coinPriceUsd
  const rawCrypto = usdAmountWithMargin / safeCoinPrice;

  // Rounding: TON to 4 decimals, others to 4 decimals
  const cryptoAmount = Math.round(rawCrypto * 10000) / 10000;

  return {
    usdAmountWithMargin: Math.round(usdAmountWithMargin * 100) / 100,
    cryptoAmount,
  };
}

export function setTestPriceCache(cache: Partial<CryptoPriceCache>): void {
  priceCache = {
    ...priceCache,
    ...cache,
  };
  invalidate(PRICE_CACHE_KEY);
}
