import React from 'react';
import type { OrderItem } from '../api.js';

export interface OrderEvent {
  id?: number;
  from_status?: string | null;
  to_status: string;
  actor_type?: string;
  note?: string | null;
  created_at?: string;
}

const STEPS: { status: string; labelEn: string; icon: string }[] = [
  { status: 'created', labelEn: 'Order Placed', icon: '🧾' },
  { status: 'awaiting_payment', labelEn: 'Awaiting Payment', icon: '⏳' },
  { status: 'pending_approval', labelEn: 'Verifying Payment', icon: '🔍' },
  { status: 'pending_fulfillment', labelEn: 'Preparing Delivery', icon: '📦' },
  { status: 'fulfilled', labelEn: 'Delivered', icon: '✅' },
];

function stepIndexFor(status: string): number {
  switch (status) {
    case 'new': return 0;
    case 'awaiting_payment': return 1;
    case 'pending_approval': return 2;
    case 'pending_fulfillment': return 3;
    case 'fulfilled': return 4;
    // Terminal failure states pin the timeline at their real stage
    case 'rejected': return 2;
    case 'refunded': return 4;
    case 'cancelled': return 1;
    default: return 0;
  }
}

export const OrderTimeline: React.FC<{ order: OrderItem; events?: OrderEvent[] }> = ({ order, events = [] }) => {
  const currentIdx = stepIndexFor(order.status);
  const isFailed = ['rejected', 'cancelled'].includes(order.status);

  // Timestamp lookup from the event log (fallback: order created_at)
  const tsFor = (stepStatus: string): string | null => {
    if (stepStatus === 'created') return order.created_at ?? null;
    const ev = [...events].reverse().find((e) => e.to_status === stepStatus);
    return ev?.created_at ?? null; // only REAL events get timestamps
  };

  return (
    <div className="order-timeline" role="list" aria-label="Order progress">
      {STEPS.map((step, i) => {
        const reached = !isFailed && i <= currentIdx;
        const isCurrent = !isFailed && i === currentIdx;
        const failedHere = order.status === 'rejected' && step.status === 'pending_approval';
        const ts = tsFor(step.status);
        const evNote = [...events].reverse().find((e) => e.to_status === step.status)?.note;

        return (
          <div key={step.status} role="listitem" className={`tl-step ${reached ? 'reached' : ''} ${isCurrent ? 'current' : ''} ${failedHere ? 'failed' : ''}`}>
            <div className="tl-marker" aria-hidden="true">
              {isFailed && failedHere ? '❌' : reached ? step.icon : '○'}
            </div>
            <div className="tl-body">
              <div className="tl-label">{step.labelEn}</div>
              {evNote && <div className="tl-note">{evNote}</div>}
              {ts && <div className="tl-ts">{new Date(ts).toLocaleString()}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default OrderTimeline;
