import http from 'k6/http';
import { BASE_URL, HEADERS } from '../config/base.js';
import { generateTransaction, newIdempotencyKey } from '../helpers/transaction.js';
import { checkCreateTransaction } from '../helpers/checks.js';

export const options = {
  scenarios: {
    write: {
      executor: 'constant-arrival-rate',
      rate: 2000,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 50,
      maxVUs: 500,
      exec: 'writeTransaction',
    },
  },
};

export function writeTransaction() {
  const payload = generateTransaction();
  const res = http.post(`${BASE_URL}/transactions`, JSON.stringify(payload), {
    headers: { ...HEADERS, 'Idempotency-Key': newIdempotencyKey() },
  });
  checkCreateTransaction(res);
}
