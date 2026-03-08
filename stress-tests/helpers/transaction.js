import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const TRANSACTION_TYPES = ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'REFUND'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'VND'];

export function newIdempotencyKey() {
  return uuidv4();
}

export function generateTransaction() {
  const type = TRANSACTION_TYPES[Math.floor(Math.random() * TRANSACTION_TYPES.length)];
  const amount = (Math.random() * 9999 + 0.01).toFixed(Math.floor(Math.random() * 8) + 1);
  const currency = CURRENCIES[Math.floor(Math.random() * CURRENCIES.length)];

  const payload = { type, amount, currency };

  if (type === 'TRANSFER') {
    payload.fromAccount = `ACC-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    payload.toAccount = `ACC-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
  } else if (type === 'DEPOSIT') {
    payload.toAccount = `ACC-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
  } else if (type === 'WITHDRAWAL') {
    payload.fromAccount = `ACC-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
  }

  if (Math.random() > 0.5) {
    payload.metadata = { note: `stress-test-${Date.now()}`, source: 'k6' };
  }

  return payload;
}
