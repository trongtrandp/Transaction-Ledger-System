import http from 'k6/http';
import { BASE_URL, HEADERS, THRESHOLDS } from '../config/base.js';
import { generateTransaction, newIdempotencyKey } from '../helpers/transaction.js';
import { checkCreateTransaction, checkListTransactions } from '../helpers/checks.js';

export const options = {
  scenarios: {
    write: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: 50,
      stages: [
        { duration: '30s', target: 1000 },
        { duration: '1m', target: 1000 }, // sustain 1K write TPS
        { duration: '30s', target: 50 },
      ],
      exec: 'writeTransaction',
    },
    read: {
      executor: 'ramping-arrival-rate',
      startRate: 20,
      timeUnit: '1s',
      preAllocatedVUs: 2,
      maxVUs: 10,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '1m', target: 200 },
        { duration: '30s', target: 20 },
      ],
      exec: 'readTransactions',
    },
  },
  thresholds: THRESHOLDS,
};

export function writeTransaction() {
  const payload = generateTransaction();
  const res = http.post(`${BASE_URL}/transactions`, JSON.stringify(payload), {
    headers: { ...HEADERS, 'Idempotency-Key': newIdempotencyKey() },
    tags: { endpoint: 'POST /transactions' },
  });
  checkCreateTransaction(res);
}

export function readTransactions() {
  const page = Math.floor(Math.random() * 10) + 1;
  const res = http.get(`${BASE_URL}/transactions?page=${page}&limit=20`, {
    headers: HEADERS,
    tags: { endpoint: 'GET /transactions' },
  });
  checkListTransactions(res);
}
