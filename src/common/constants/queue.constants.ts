export const TRANSACTION_QUEUE = 'transaction-queue';
export const NOTIFICATION_QUEUE = 'notification-queue';

// Retry configuration
export const TRANSACTION_MAX_ATTEMPTS = 3;
export const TRANSACTION_BACKOFF_DELAY = 2000;
export const NOTIFICATION_MAX_ATTEMPTS = 3;
export const NOTIFICATION_BACKOFF_DELAY = 1000;

// Job names
export const PROCESS_TRANSACTION_JOB = 'process-transaction';
export const SEND_NOTIFICATION_JOB = 'send-notification';
