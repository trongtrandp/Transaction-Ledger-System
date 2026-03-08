-- AlterTable: Add DEFAULT CURRENT_TIMESTAMP to updated_at columns
ALTER TABLE "transactions" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "idempotency_records" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "notifications" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: Add expires_at column to idempotency_records
ALTER TABLE "idempotency_records" ADD COLUMN "expires_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours');

-- CreateIndex: Add index on expires_at for cleanup queries
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex: Add unique constraint on (transaction_id, channel) for notification dedup
CREATE UNIQUE INDEX "notifications_transaction_id_channel_key" ON "notifications"("transaction_id", "channel");

-- DropIndex: Remove redundant transaction_id index (covered by the unique constraint)
DROP INDEX "notifications_transaction_id_idx";
