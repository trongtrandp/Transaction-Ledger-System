-- CreateIndex: Partial unique index to prevent duplicate DELIVERED notifications per (transaction_id, channel).
-- This is an additional safety net on top of the full unique constraint — ensures at most one DELIVERED row.
CREATE UNIQUE INDEX "notifications_tx_channel_delivered_uniq"
ON "notifications" ("transaction_id", "channel")
WHERE "status" = 'DELIVERED';
