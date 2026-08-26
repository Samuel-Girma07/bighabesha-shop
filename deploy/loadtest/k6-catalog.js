// =============================================================================
// Bighabesha Shop — Browse & Bootstrap load profile
// Run:  k6 run -e BASE_URL=https://api.staging.example.com [-e TMA_INIT_DATA=...] k6-catalog.js
// =============================================================================
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
// Fresh initData from the Mini App WebView console:
//   window.Telegram.WebApp.initData
const TMA = __ENV.TMA_INIT_DATA || '';

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '2m', target: 200 },
        { duration: '1m', target: 0 },
      ],
      exec: 'browse',
    },
    bootstrap: {
      executor: 'constant-vus',
      vus: 30,
      duration: '3m',
      exec: 'bootstrap',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<400', 'p(99)<900'],
  },
};

export function browse() {
  const health = http.get(`${BASE}/api/health`);
  check(health, { 'health 200': (r) => r.status === 200 });
  sleep(Math.random() * 3 + 1);
}

export function bootstrap() {
  if (!TMA) return;
  const r = http.get(`${BASE}/api/bootstrap`, {
    headers: { Authorization: `tma ${TMA}` },
  });
  check(r, {
    'bootstrap 200': (res) => res.status === 200,
    'has products': (res) => res.json('products') !== undefined,
  });
  sleep(Math.random() * 5 + 2);
}
