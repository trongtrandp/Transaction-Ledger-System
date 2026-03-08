import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationProcessor } from './notification.processor';
import {
  NOTIFICATION_QUEUE,
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_BACKOFF_DELAY,
} from '../common/constants/queue.constants';

@Module({
  imports: [
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
  controllers: [NotificationController],
  providers: [NotificationService, NotificationProcessor],
})
export class NotificationModule {}
