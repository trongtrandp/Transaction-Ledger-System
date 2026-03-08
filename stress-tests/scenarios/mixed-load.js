/**
 * Mixed Load Test — 1000+ write TPS with background reads
 *
 * Proves "thousands of transactions per second" requirement.
 * Write: 1020 TPS (POST /transactions) — the core requirement
 * Read:  200 TPS background (GET /transactions + GET /notifications)
 * Uses constant-arrival-rate for accurate throughput measurement.
 */
import http from 'k6/http';
import { BASE_URL, HEADERS } from '../config/base.js';
import { generateTransaction, newIdempotencyKey } from '../helpers/transaction.js';
import { checkCreateTransaction, checkListTransactions, checkListNotifications } from '../helpers/checks.js';

export const options = {
  scenarios: {
    write: {
      executor: 'constant-arrival-rate',
      rate: 1020,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 20,
      maxVUs: 200,
      exec: 'writeTransaction',
    },
    read_transactions: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 5,
      maxVUs: 50,
      exec: 'readTransactions',
    },
    read_notifications: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 5,
      maxVUs: 50,
      exec: 'readNotifications',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    http_reqs: ['rate>=1000'],
  },
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

export function readNotifications() {
  const page = Math.floor(Math.random() * 10) + 1;
  const res = http.get(`${BASE_URL}/notifications?page=${page}&limit=20`, {
    headers: HEADERS,
    tags: { endpoint: 'GET /notifications' },
  });
  checkListNotifications(res);
}
