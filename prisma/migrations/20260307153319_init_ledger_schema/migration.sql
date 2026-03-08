-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'REFUND');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'QUEUED',
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "from_account" VARCHAR(255),
    "to_account" VARCHAR(255),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "status_code" INTEGER,
    "response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" VARCHAR(255) NOT NULL,
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_key_key" ON "idempotency_records"("key");

-- CreateIndex
CREATE INDEX "transactions_status_created_at_idx" ON "transactions"("status", "created_at");

-- CreateIndex
CREATE INDEX "transactions_from_account_idx" ON "transactions"("from_account");

-- CreateIndex
CREATE INDEX "transactions_to_account_idx" ON "transactions"("to_account");

-- CreateIndex
CREATE INDEX "notifications_transaction_id_idx" ON "notifications"("transaction_id");

-- CreateIndex
CREATE INDEX "notifications_status_channel_idx" ON "notifications"("status", "channel");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
