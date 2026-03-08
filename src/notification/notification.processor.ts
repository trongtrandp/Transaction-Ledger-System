import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { NOTIFICATION_QUEUE, NOTIFICATION_MAX_ATTEMPTS } from '../common/constants/queue.constants';
import { NotificationStatus } from '../generated/prisma/client';

@Processor(NOTIFICATION_QUEUE, {
  concurrency: 5,
})
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job) {
    const { transactionId, channel, recipient, payload } = job.data;

    this.logger.log(`Processing notification for transaction ${transactionId}`);

    // Guard against duplicate notifications from transaction job retries.
    // If a prior notification job already delivered for this transaction,
    // skip silently — the deterministic jobId on the enqueue side handles
    // the "job still in queue" window, this covers "job completed + removed".
    const existing = await this.prisma.notification.count({
      where: { transactionId, status: NotificationStatus.DELIVERED },
    });
    if (existing > 0) {
      this.logger.log(`Notification already delivered for transaction ${transactionId}, skipping`);
      return { transactionId, status: 'already_delivered' };
    }

    // Simulate sending notification
    this.logger.log(`Sending ${channel} notification to ${recipient}`);

    // Create notification record as DELIVERED
    const notification = await this.prisma.notification.create({
      data: {
        transactionId,
        channel,
        status: NotificationStatus.DELIVERED,
        recipient,
        payload,
        attempts: job.attemptsMade + 1,
      },
    });

    this.logger.log(`Notification ${notification.id} delivered`);
    return { notificationId: notification.id, status: NotificationStatus.DELIVERED };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, error: Error) {
    this.logger.warn(`Notification job ${job.id} failed (attempt ${job.attemptsMade}): ${error.message}`);

    if (job.attemptsMade >= NOTIFICATION_MAX_ATTEMPTS) {
      this.logger.error(`Notification job ${job.id} moved to dead letter after ${NOTIFICATION_MAX_ATTEMPTS} attempts`);

      const { transactionId, channel, recipient, payload } = job.data;

      // process() failed before creating a record, so create DEAD_LETTER directly
      await this.prisma.notification.create({
        data: {
          transactionId,
          channel,
          status: NotificationStatus.DEAD_LETTER,
          recipient,
          payload,
          attempts: job.attemptsMade,
          lastError: error.message,
        },
      });
    }
  }
}
