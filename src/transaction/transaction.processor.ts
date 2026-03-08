import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { TRANSACTION_QUEUE, NOTIFICATION_QUEUE, SEND_NOTIFICATION_JOB } from '../common/constants/queue.constants';
import { TransactionStatus, NotificationChannel, Prisma } from '../generated/prisma/client';

@Processor(TRANSACTION_QUEUE, {
  concurrency: 5,
})
export class TransactionProcessor extends WorkerHost {
  private readonly logger = new Logger(TransactionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly notificationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job) {
    const { transactionId, fromAccount, toAccount } = job.data;

    this.logger.log(`Processing transaction ${transactionId}`);

    const existing = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!existing) {
      this.logger.error(`Transaction ${transactionId} not found in DB, skipping`);
      return;
    }

    if (existing.status === TransactionStatus.COMPLETED) {
      this.logger.log(`Transaction ${transactionId} already completed, ensuring notification`);
      await this.enqueueNotification(existing, fromAccount, toAccount);
      return existing;
    }

    // Transition QUEUED/FAILED → PROCESSING (only allow from non-active states to prevent concurrent processing)
    const started = await this.prisma.transaction.updateMany({
      where: { id: transactionId, status: { in: [TransactionStatus.QUEUED, TransactionStatus.FAILED] } },
      data: { status: TransactionStatus.PROCESSING },
    });
    if (started.count === 0) {
      this.logger.warn(`Transaction ${transactionId} not in retryable state, skipping`);
      return existing;
    }

    // Transition PROCESSING → COMPLETED
    const transaction = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { status: TransactionStatus.COMPLETED },
    });

    await this.enqueueNotification(transaction, fromAccount, toAccount);

    this.logger.log(`Transaction ${transactionId} completed`);
    return transaction;
  }

  private async enqueueNotification(
    transaction: { id: string; type: string; amount: Prisma.Decimal; currency: string },
    fromAccount?: string,
    toAccount?: string,
  ) {
    const recipient = fromAccount ?? toAccount;
    if (recipient) {
      // Deterministic jobId ensures BullMQ deduplicates at the queue level.
      // If a job with this ID already exists (waiting/active/delayed/completed),
      // queue.add() returns the existing job instead of creating a duplicate.
      await this.notificationQueue.add(
        SEND_NOTIFICATION_JOB,
        {
          transactionId: transaction.id,
          channel: NotificationChannel.EMAIL,
          recipient,
          payload: {
            type: transaction.type,
            amount: transaction.amount.toString(),
            currency: transaction.currency,
          },
        },
        { jobId: `notif-${transaction.id}` },
      );
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, error: Error) {
    const { transactionId } = job.data;
    this.logger.error(`Transaction job ${job.id} failed: ${error.message}`);

    // Only mark as FAILED if not already COMPLETED — prevents corrupting finished transactions
    try {
      await this.prisma.transaction.updateMany({
        where: { id: transactionId, status: { not: TransactionStatus.COMPLETED } },
        data: { status: TransactionStatus.FAILED },
      });
    } catch (updateError) {
      this.logger.warn(`Could not mark transaction ${transactionId} as FAILED: ${updateError}`);
    }
  }
}
