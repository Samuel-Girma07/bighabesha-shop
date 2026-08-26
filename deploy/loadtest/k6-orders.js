// =============================================================================
// Bighabesha Shop — Order creation + Admin polling load profile (STAGING ONLY)
// Run:  k6 run -e BASE_URL=... -e TMA_INIT_DATA=... -e ADMIN_TOKEN=... k6-orders.js
//
// NOTE: order-create bursts intentionally exceed the 10/min/IP checkout
// limiter at the top ramp — expect a controlled share of HTTP 429 there;
// the threshold below tolerates it. Never point this at production.
// =============================================================================
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const TMA = __ENV.TMA_INIT_DATA || '';
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || '';

export const options = {
  scenarios: {
    create_orders: {
      executor: 'ramping-arrival-rate',
      startRate: 2,
      timeUnit: '1m',
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { duration: '1m', target: 30 },   // ramp to 30 OPM
        { duration: '3m', target: 30 },   // sustain
        { duration: '1m', target: 120 },  // burst — watch SQLITE_BUSY / 429s
      ],
      exec: 'createOrder',
    },
    admin_poll: {
      executor: 'constant-vus',
      vus: 5,
      duration: '5m',
      exec: 'adminPoll',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'http_req_duration{name:createOrder}': ['p(95)<800'],
    'http_req_duration{name:adminPoll}': ['p(95)<300'],
  },
};

export function createOrder() {
  if (!TMA) return;
  const res = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({ productId: 'gemini_pro_18m', paymentRail: 'cbe' }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `tma ${TMA}` },
      tags: { name: 'createOrder' },
    }
  );
  check(res, {
    'order created or politely limited': (r) => [201, 400, 409, 429].includes(r.status),
  });
  sleep(1);
}

export function adminPoll() {
  if (!ADMIN_TOKEN) return;
  const r = http.get(`${BASE}/api/admin/orders?status=pending_approval`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    tags: { name: 'adminPoll' },
  });
  check(r, { 'admin orders 200': (x) => x.status === 200 });
  sleep(10); // mirrors dashboard live-sync cadence
}
