export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

export const THRESHOLDS = {
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
  http_req_failed: ['rate<0.01'],
  http_reqs: ['rate>=800'], // accounts for ramp-up/cooldown averaging
};

export const THRESHOLDS_RELAXED = {
  http_req_duration: ['p(95)<2000', 'p(99)<5000'],
  http_req_failed: ['rate<0.05'],
};
