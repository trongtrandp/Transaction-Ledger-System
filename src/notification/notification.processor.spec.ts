import { Test, TestingModule } from '@nestjs/testing';
import { NotificationProcessor } from './notification.processor';
import { PrismaService } from '../common/prisma/prisma.service';
import { NOTIFICATION_MAX_ATTEMPTS } from '../common/constants/queue.constants';
import { NotificationStatus } from '../generated/prisma/client';
import { Job } from 'bullmq';

describe('NotificationProcessor', () => {
  let processor: NotificationProcessor;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      notification: {
        create: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationProcessor,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    processor = module.get(NotificationProcessor);
    prisma = module.get(PrismaService);
  });

  describe('process', () => {
    it('should create notification with DELIVERED status', async () => {
      const job = {
        id: 'job-1',
        data: {
          transactionId: 'tx-1',
          channel: 'EMAIL',
          recipient: 'user@example.com',
          payload: { type: 'DEPOSIT', amount: '100' },
        },
        attemptsMade: 0,
      } as unknown as Job;

      (prisma.notification.count as jest.Mock).mockResolvedValue(0);
      const created = { id: 'notif-1', status: NotificationStatus.DELIVERED };
      (prisma.notification.create as jest.Mock).mockResolvedValue(created);

      const result = await processor.process(job);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          transactionId: 'tx-1',
          channel: 'EMAIL',
          status: NotificationStatus.DELIVERED,
          recipient: 'user@example.com',
          payload: { type: 'DEPOSIT', amount: '100' },
        }),
      });
      expect(result).toEqual({
        notificationId: 'notif-1',
        status: NotificationStatus.DELIVERED,
      });
    });

    it('should set attempts to job.attemptsMade + 1', async () => {
      const job = {
        id: 'job-2',
        data: {
          transactionId: 'tx-2',
          channel: 'SMS',
          recipient: '+1234567890',
          payload: {},
        },
        attemptsMade: 2,
      } as unknown as Job;

      (prisma.notification.count as jest.Mock).mockResolvedValue(0);
      (prisma.notification.create as jest.Mock).mockResolvedValue({ id: 'notif-2' });

      await processor.process(job);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          attempts: 3,
        }),
      });
    });

    it('should skip when a DELIVERED notification already exists for the transaction', async () => {
      const job = {
        id: 'job-dup',
        data: {
          transactionId: 'tx-1',
          channel: 'EMAIL',
          recipient: 'user@example.com',
          payload: { type: 'DEPOSIT', amount: '100' },
        },
        attemptsMade: 0,
      } as unknown as Job;

      (prisma.notification.count as jest.Mock).mockResolvedValue(1);

      const result = await processor.process(job);

      expect(result).toEqual({ transactionId: 'tx-1', status: 'already_delivered' });
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('onFailed', () => {
    it('should NOT create record when attemptsMade < NOTIFICATION_MAX_ATTEMPTS', async () => {
      const job = {
        id: 'job-3',
        data: {
          transactionId: 'tx-3',
          channel: 'EMAIL',
          recipient: 'user@example.com',
          payload: {},
        },
        attemptsMade: NOTIFICATION_MAX_ATTEMPTS - 1,
      } as unknown as Job;

      await processor.onFailed(job, new Error('temporary failure'));

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('should create DEAD_LETTER record when attemptsMade >= NOTIFICATION_MAX_ATTEMPTS', async () => {
      const job = {
        id: 'job-4',
        data: {
          transactionId: 'tx-4',
          channel: 'EMAIL',
          recipient: 'user@example.com',
          payload: { type: 'WITHDRAWAL' },
        },
        attemptsMade: NOTIFICATION_MAX_ATTEMPTS,
      } as unknown as Job;

      const error = new Error('permanent failure');
      (prisma.notification.create as jest.Mock).mockResolvedValue({});

      await processor.onFailed(job, error);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          transactionId: 'tx-4',
          channel: 'EMAIL',
          status: NotificationStatus.DEAD_LETTER,
          recipient: 'user@example.com',
          payload: { type: 'WITHDRAWAL' },
          attempts: NOTIFICATION_MAX_ATTEMPTS,
          lastError: 'permanent failure',
        },
      });
    });
  });
});
