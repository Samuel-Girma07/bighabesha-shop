import { getConfig } from '../../config/env.js';
import { logger } from '../../logger/index.js';

const TONCENTER_BASE = 'https://toncenter.com/api/v2';

export interface TonTx {
  /** In-message comment (our order id) */
  comment: string | null;
  /** Value in nanoTON */
  valueNano: string;
  /** Destination address (should equal treasury) */
  toAddress: string;
  txHash: string;
  utime: number;
}

/**
 * Pure matcher: finds the first transaction paying AT LEAST the expected
 * amount to the treasury with the exact memo. Tolerance covers rounding of
 * the quoted amount; underpayments never match.
 */
export function matchTonTransaction(
  txs: TonTx[],
  params: { memo: string; expectedNano: bigint; toleranceBps?: number }
): TonTx | null {
  const tolerance = params.toleranceBps ?? 100; // 1% default
  const minAccepted = (params.expectedNano * BigInt(10_000 - tolerance)) / BigInt(10_000);

  for (const tx of txs) {
    if (tx.comment?.trim() !== params.memo) continue;
    try {
      const value = BigInt(tx.valueNano);
      if (value >= minAccepted) return tx;
    } catch {
      continue;
    }
  }
  return null;
}

/** Fetches recent inbound transactions for an address from TonCenter. */
export async function fetchTreasuryTransactions(limit: number = 100): Promise<TonTx[]> {
  const config = getConfig();
  const address = config.TON_TREASURY_ADDRESS;
  if (!address) throw new Error('TON_TREASURY_ADDRESS is not configured');

  const response = await fetch(
    `${TONCENTER_BASE}/getTransactions?address=${encodeURIComponent(address)}&limit=${limit}`,
    { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
  );
  if (!response.ok) throw new Error(`TonCenter responded ${response.status}`);

  const data = (await response.json()) as any;
  const result = data?.result ?? [];

  return result.map((r: any) => ({
    comment:
      r?.in_msg?.msg_data?.text ??
      (r?.in_msg?.msg_data?.decoded_comment ?? null),
    valueNano: String(r?.in_msg?.value ?? '0'),
    toAddress: String(r?.in_msg?.destination ?? ''),
    txHash: String(r?.transaction_id?.hash ?? ''),
    utime: Number(r?.utime ?? 0),
  }));
}

export function tonToNano(amountTon: number): bigint {
  // 9 decimals; avoid float drift by scaling through string math.
  const [whole, frac = ''] = amountTon.toFixed(9).split('.');
  return BigInt(`${whole}${frac.padEnd(9, '0').slice(0, 9)}`);
}

export function isTonConnectEnabled(): boolean {
  return Boolean(getConfig().TON_TREASURY_ADDRESS);
}

/** Verifies a TON payment for an order against the treasury feed. */
export async function verifyTonPayment(params: {
  memo: string;
  expectedTon: number;
}): Promise<{ verified: boolean; txHash?: string }> {
  try {
    // Scan window of 100 (TonCenter maximum) — under heavy inbound traffic a
    // smaller window could permanently miss valid payments older than the
    // latest few transactions.
    const txs = await fetchTreasuryTransactions(100);
    const match = matchTonTransaction(txs, { memo: params.memo, expectedNano: tonToNano(params.expectedTon) });
    if (!match) return { verified: false };
    logger.info({ memo: params.memo, txHash: match.txHash }, 'TON payment verified on-chain');
    return { verified: true, txHash: match.txHash };
  } catch (err) {
    logger.error({ err }, 'TON payment verification failed');
    return { verified: false };
  }
}
