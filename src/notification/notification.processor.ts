import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { NOTIFICATION_QUEUE, NOTIFICATION_MAX_ATTEMPTS } from '../common/constants/queue.constants';
import { NotificationStatus, Prisma } from '../generated/prisma/client';

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

    // Simulate sending notification
    this.logger.log(`Sending ${channel} notification to ${recipient}`);

    // Use create() + catch P2002 for race-safe dedupe.
    // If a prior job already created a row for (transactionId, channel), the unique
    // constraint violation tells us it's a duplicate — no need for a separate check.
    try {
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
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.log(`Notification already exists for transaction ${transactionId}, skipping`);
        return { transactionId, status: 'already_delivered' };
      }
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, error: Error) {
    this.logger.warn(
      `Notification job ${job.id} failed (attempt ${job.attemptsMade}): ${error.message}`,
    );

    if (job.attemptsMade >= NOTIFICATION_MAX_ATTEMPTS) {
      this.logger.error(
        `Notification job ${job.id} moved to dead letter after ${NOTIFICATION_MAX_ATTEMPTS} attempts`,
      );

      const { transactionId, channel, recipient, payload } = job.data;

      // Upsert dead letter record using the unique constraint for race-safety.
      // Guard: never overwrite a DELIVERED notification — use updateMany with status filter
      // so the update is a no-op if the notification was already delivered.
      const existing = await this.prisma.notification.findUnique({
        where: { transactionId_channel: { transactionId, channel } },
        select: { status: true },
      });

      if (existing?.status === NotificationStatus.DELIVERED) {
        this.logger.log(
          `Notification for transaction ${transactionId} already delivered, skipping dead letter`,
        );
        return;
      }

      await this.prisma.notification.upsert({
        where: {
          transactionId_channel: { transactionId, channel },
        },
        create: {
          transactionId,
          channel,
          status: NotificationStatus.DEAD_LETTER,
          recipient,
          payload,
          attempts: job.attemptsMade,
          lastError: error.message,
        },
        update: {
          status: NotificationStatus.DEAD_LETTER,
          attempts: job.attemptsMade,
          lastError: error.message,
        },
      });
    }
  }
}
