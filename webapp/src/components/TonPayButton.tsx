import React, { useRef, useState } from 'react';
import { useTonConnectUI } from '@tonconnect/ui-react';
import { beginCell } from '@ton/core';
import { convertDisplay } from '../utils.js';
import { verifyTonPaymentApi } from '../api.js';
import { haptic } from '../haptics.js';

interface Props {
  orderId: string;
  amountEtb: number;
  rates: { etbPerUsd: number; tonUsd: number };
  treasuryAddress?: string;
  onVerified: () => void;
}

/**
 * Non-custodial TON payment: sends an exact-amount transaction with the
 * order id as the text comment (memo), then polls the backend for
 * on-chain verification.
 */
export const TonPayButton: React.FC<Props> = ({ orderId, amountEtb, rates, treasuryAddress, onVerified }) => {
  const [tonConnectUI] = useTonConnectUI();
  const [state, setState] = useState<'idle' | 'sending' | 'polling' | 'error'>('idle');
  const mountedRef = useRef(true);
  React.useEffect(() => () => { mountedRef.current = false; }, []);

  if (!treasuryAddress) return null;

  const pay = async (): Promise<void> => {
    try {
      haptic.tap();
      setState('sending');
      const { value: ton } = convertDisplay(amountEtb, 'TON', rates);
      if (!(ton > 0)) { setState('error'); return; }
      // Integer math: round at 4dp first to avoid double-rounding drift.
      const nanoAmount = (BigInt(Math.round(ton * 10000)) * 100000000n).toString();

      // Text comment (memo) payload: 0x00000000 opcode + UTF-8 tail
      const payload = beginCell()
        .storeUint(0, 32)
        .storeStringTail(orderId)
        .endCell()
        .toBoc()
        .toString('base64');

      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: treasuryAddress,
            amount: nanoAmount,
            payload,
          },
        ],
      });

      // Poll backend for on-chain confirmation (up to ~2 minutes).
      if (!mountedRef.current) return;
        setState('polling');
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline && mountedRef.current) {
        await new Promise((r) => setTimeout(r, 4000));
        try {
          const res = await verifyTonPaymentApi(orderId);
          if (res.verified) {
            haptic.success();
            onVerified();
            return;
          }
        } catch { /* keep polling */ }
      }
      setState('error');
      haptic.warn();
    } catch (err) {
      // User rejected or network error
      setState('error');
      haptic.error();
    }
  };

  return (
    <button className="btn-action-main" onClick={pay} disabled={state === 'sending' || state === 'polling'} style={{ marginBottom: '10px' }}>
      {state === 'sending'
        ? 'Confirm in wallet…'
        : state === 'polling'
          ? 'Verifying on-chain…'
          : state === 'error'
            ? 'Retry TON Payment'
            : '🪙 Pay with TON Wallet'}
    </button>
  );
};

export default TonPayButton;
