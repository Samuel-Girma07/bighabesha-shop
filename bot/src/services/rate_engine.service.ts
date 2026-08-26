import { getNumericSetting, getSetting } from './settings.service.js';
import { logger } from '../logger/index.js';

export interface CryptoPriceCache {
  tonUsd: number;
  usdtUsd: number;
  lastFetchedAt: number;
}

// In-memory cache for crypto prices (5 minutes TTL)
let priceCache: CryptoPriceCache = {
  tonUsd: 3.50, // Realistic market baseline
  usdtUsd: 1.0,
  lastFetchedAt: Date.now(),
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getFallbackTonUsd(): number {
  return getNumericSetting('fallback_ton_usd', 3.50);
}

export async function fetchCoinGeckoPrices(forceRefresh = false): Promise<{ tonUsd: number; usdtUsd: number }> {
  const now = Date.now();
  if (!forceRefresh && priceCache.lastFetchedAt > 0 && now - priceCache.lastFetchedAt < CACHE_TTL_MS) {
    return { tonUsd: priceCache.tonUsd, usdtUsd: priceCache.usdtUsd };
  }

  const fallbackTon = getFallbackTonUsd();

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,tether&vs_currencies=usd',
      { signal: AbortSignal.timeout(5000) }
    );

    if (res.status === 429) {
      logger.warn('CoinGecko API 429 rate limit reached, serving cached/fallback crypto prices');
      return { tonUsd: priceCache.tonUsd || fallbackTon, usdtUsd: priceCache.usdtUsd || 1.0 };
    }

    if (!res.ok) {
      throw new Error(`CoinGecko responded with status ${res.status}`);
    }

    const data = (await res.json()) as {
      'the-open-network'?: { usd?: number };
      tether?: { usd?: number };
    };

    const tonUsd = data['the-open-network']?.usd || priceCache.tonUsd || fallbackTon;
    const usdtUsd = data.tether?.usd || 1.0;

    priceCache = {
      tonUsd,
      usdtUsd,
      lastFetchedAt: now,
    };

    logger.debug({ tonUsd, usdtUsd }, 'Updated crypto prices from CoinGecko');
    return { tonUsd, usdtUsd };
  } catch (err: any) {
    logger.warn({ err: err?.message || err }, 'Failed to fetch CoinGecko rates, using cached or fallback prices.');
    return { tonUsd: priceCache.tonUsd || fallbackTon, usdtUsd: priceCache.usdtUsd || 1.0 };
  }
}

export async function fetchLiveUSDToETB(): Promise<number | null> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      throw new Error(`Exchange rate API responded with status ${res.status}`);
    }
    const data = (await res.json()) as { rates?: { ETB?: number } };
    if (data.rates && typeof data.rates.ETB === 'number') {
      logger.info({ liveEtbPerUsd: data.rates.ETB }, 'Fetched live USD to ETB exchange rate');
      return data.rates.ETB;
    }
    return null;
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch live USD to ETB rate from open.er-api.com');
    return null;
  }
}

export function calculateStarsDue(priceETB: number, customEtbPerStar?: number): number {
  const etbPerStar = customEtbPerStar ?? getNumericSetting('etb_per_star', 2.5);
  if (etbPerStar <= 0) return Math.ceil(priceETB);
  return Math.ceil(priceETB / etbPerStar);
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
}
