import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';
import { TransactionProcessor } from './transaction.processor';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import {
  TRANSACTION_QUEUE,
  NOTIFICATION_QUEUE,
  TRANSACTION_MAX_ATTEMPTS,
  TRANSACTION_BACKOFF_DELAY,
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_BACKOFF_DELAY,
} from '../common/constants/queue.constants';

@Module({
  imports: [
    IdempotencyModule,
    BullModule.registerQueue({
      name: TRANSACTION_QUEUE,
      defaultJobOptions: {
        attempts: TRANSACTION_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: TRANSACTION_BACKOFF_DELAY },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
    BullModule.registerQueue({
      name: NOTIFICATION_QUEUE,
      defaultJobOptions: {
        attempts: NOTIFICATION_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: NOTIFICATION_BACKOFF_DELAY },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  controllers: [TransactionController],
  providers: [TransactionService, TransactionProcessor],
})
export class TransactionModule {}
