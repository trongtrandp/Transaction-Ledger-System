import { check } from 'k6';

export function checkCreateTransaction(res) {
  return check(res, {
    'POST /transactions status is 202': (r) => r.status === 202,
    'POST /transactions has id': (r) => {
      try {
        const body = r.json();
        return body && typeof body.id === 'string';
      } catch {
        return false;
      }
    },
  });
}

export function checkListTransactions(res) {
  return check(res, {
    'GET /transactions status is 200': (r) => r.status === 200,
    'GET /transactions has data array': (r) => {
      try {
        const body = r.json();
        return body && Array.isArray(body.data);
      } catch {
        return false;
      }
    },
    'GET /transactions has pagination': (r) => {
      try {
        const body = r.json();
        return body && typeof body.total === 'number' && typeof body.page === 'number';
      } catch {
        return false;
      }
    },
  });
}

export function checkListNotifications(res) {
  return check(res, {
    'GET /notifications status is 200': (r) => r.status === 200,
    'GET /notifications has data array': (r) => {
      try {
        const body = r.json();
        return body && Array.isArray(body.data);
      } catch {
        return false;
      }
    },
  });
}
