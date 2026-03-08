import http from 'k6/http';
import { BASE_URL, HEADERS, THRESHOLDS_RELAXED } from '../config/base.js';
import { generateTransaction, newIdempotencyKey } from '../helpers/transaction.js';
import { checkCreateTransaction, checkListTransactions } from '../helpers/checks.js';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: 100,
      stages: [
        { duration: '30s', target: 100 },   // baseline
        { duration: '10s', target: 2000 },   // spike up
        { duration: '1m', target: 2000 },    // hold spike
        { duration: '10s', target: 100 },    // drop
        { duration: '2m', target: 100 },     // recovery
      ],
      exec: 'mixedTraffic',
    },
  },
  thresholds: THRESHOLDS_RELAXED,
};

export function mixedTraffic() {
  // 80% writes, 20% reads (write-heavy system)
  if (Math.random() < 0.8) {
    const payload = generateTransaction();
    const res = http.post(`${BASE_URL}/transactions`, JSON.stringify(payload), {
      headers: { ...HEADERS, 'Idempotency-Key': newIdempotencyKey() },
      tags: { endpoint: 'POST /transactions' },
    });
    checkCreateTransaction(res);
  } else {
    const page = Math.floor(Math.random() * 10) + 1;
    const res = http.get(`${BASE_URL}/transactions?page=${page}&limit=20`, {
      headers: HEADERS,
      tags: { endpoint: 'GET /transactions' },
    });
    checkListTransactions(res);
  }
}
