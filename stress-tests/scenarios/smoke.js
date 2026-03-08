import http from 'k6/http';
import { sleep } from 'k6';
import { BASE_URL, HEADERS } from '../config/base.js';
import { generateTransaction, newIdempotencyKey } from '../helpers/transaction.js';
import { checkCreateTransaction, checkListTransactions, checkListNotifications } from '../helpers/checks.js';

export const options = {
  vus: 2,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.1'],
  },
};

export default function () {
  // POST /transactions
  const payload = generateTransaction();
  const createRes = http.post(`${BASE_URL}/transactions`, JSON.stringify(payload), {
    headers: { ...HEADERS, 'Idempotency-Key': newIdempotencyKey() },
    tags: { endpoint: 'POST /transactions' },
  });
  checkCreateTransaction(createRes);

  sleep(0.5);

  // GET /transactions
  const listRes = http.get(`${BASE_URL}/transactions?page=1&limit=10`, {
    headers: HEADERS,
    tags: { endpoint: 'GET /transactions' },
  });
  checkListTransactions(listRes);

  sleep(0.5);

  // GET /notifications
  const notifRes = http.get(`${BASE_URL}/notifications?page=1&limit=10`, {
    headers: HEADERS,
    tags: { endpoint: 'GET /notifications' },
  });
  checkListNotifications(notifRes);

  sleep(0.5);
}
