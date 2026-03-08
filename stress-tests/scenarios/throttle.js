import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, HEADERS } from '../config/base.js';
import { generateTransaction, newIdempotencyKey } from '../helpers/transaction.js';

const throttledRequests = new Counter('throttled_requests');
const passedRequests = new Counter('passed_requests');

export const options = {
  scenarios: {
    throttle_test: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 50,
      maxVUs: 100,
      exec: 'throttleTest',
    },
  },
  thresholds: {
    throttled_requests: ['count>0'],
    'checks': ['rate>0.9'],
  },
};

export function throttleTest() {
  const payload = generateTransaction();
  const res = http.post(`${BASE_URL}/transactions`, JSON.stringify(payload), {
    headers: { ...HEADERS, 'Idempotency-Key': newIdempotencyKey() },
    tags: { endpoint: 'POST /transactions' },
  });

  if (res.status === 429) {
    throttledRequests.add(1);
  } else {
    passedRequests.add(1);
  }

  check(res, {
    'throttle: response is 202 or 429': (r) => r.status === 202 || r.status === 429,
  });
}
