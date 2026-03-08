import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, HEADERS } from '../config/base.js';
import { generateTransaction, newIdempotencyKey } from '../helpers/transaction.js';

export const options = {
  scenarios: {
    replay: {
      executor: 'per-vu-iterations',
      vus: 10,
      iterations: 50,
      exec: 'replayIdempotency',
      tags: { scenario: 'replay' },
    },
    conflict: {
      executor: 'per-vu-iterations',
      vus: 10,
      iterations: 50,
      startTime: '30s',
      exec: 'conflictIdempotency',
      tags: { scenario: 'conflict' },
    },
    concurrent: {
      executor: 'per-vu-iterations',
      vus: 20,
      iterations: 25,
      startTime: '60s',
      exec: 'concurrentIdempotency',
      tags: { scenario: 'concurrent' },
    },
  },
  thresholds: {
    'checks{scenario:replay}': ['rate>0.95'],
    'checks{scenario:conflict}': ['rate>0.95'],
  },
};

// Replay: same key + same body => 202 (cached response)
export function replayIdempotency() {
  const key = newIdempotencyKey();
  const payload = generateTransaction();
  const body = JSON.stringify(payload);
  const headers = { ...HEADERS, 'Idempotency-Key': key };

  // First request
  const first = http.post(`${BASE_URL}/transactions`, body, {
    headers,
    tags: { endpoint: 'POST /transactions', scenario: 'replay' },
  });
  check(first, {
    'replay: first request is 202': (r) => r.status === 202,
  });

  sleep(0.5);

  // Replay with same key + same body
  const replay = http.post(`${BASE_URL}/transactions`, body, {
    headers,
    tags: { endpoint: 'POST /transactions', scenario: 'replay' },
  });
  check(replay, {
    'replay: second request is 202 (cached)': (r) => r.status === 202,
  });
}

// Conflict: same key + different body => 422
export function conflictIdempotency() {
  const key = newIdempotencyKey();
  const headers = { ...HEADERS, 'Idempotency-Key': key };

  const first = http.post(`${BASE_URL}/transactions`, JSON.stringify(generateTransaction()), {
    headers,
    tags: { endpoint: 'POST /transactions', scenario: 'conflict' },
  });
  check(first, {
    'conflict: first request is 202': (r) => r.status === 202,
  });

  sleep(0.5);

  // Different body, same key
  const conflict = http.post(`${BASE_URL}/transactions`, JSON.stringify(generateTransaction()), {
    headers,
    tags: { endpoint: 'POST /transactions', scenario: 'conflict' },
  });
  check(conflict, {
    'conflict: different body is 422': (r) => r.status === 422,
  });
}

// Concurrent: same key fired simultaneously => one 202, rest 409
export function concurrentIdempotency() {
  const key = newIdempotencyKey();
  const payload = generateTransaction();
  const body = JSON.stringify(payload);
  const headers = { ...HEADERS, 'Idempotency-Key': key };

  // Fire batch of concurrent requests with same key
  const responses = http.batch([
    ['POST', `${BASE_URL}/transactions`, body, { headers, tags: { endpoint: 'POST /transactions', scenario: 'concurrent' } }],
    ['POST', `${BASE_URL}/transactions`, body, { headers, tags: { endpoint: 'POST /transactions', scenario: 'concurrent' } }],
    ['POST', `${BASE_URL}/transactions`, body, { headers, tags: { endpoint: 'POST /transactions', scenario: 'concurrent' } }],
  ]);

  const statuses = responses.map((r) => r.status);
  const has202 = statuses.includes(202);
  const has409 = statuses.includes(409);

  check(null, {
    'concurrent: at least one 202': () => has202,
    'concurrent: has 409 conflicts': () => has409,
    'concurrent: all responses are 202 or 409': () => statuses.every((s) => s === 202 || s === 409),
  });
}
