import { Test, TestingModule } from '@nestjs/testing';
import { NotificationProcessor } from './notification.processor';
import { PrismaService } from '../common/prisma/prisma.service';
import { NOTIFICATION_MAX_ATTEMPTS } from '../common/constants/queue.constants';
import { NotificationStatus, Prisma } from '../generated/prisma/client';
import { Job } from 'bullmq';

describe('NotificationProcessor', () => {
  let processor: NotificationProcessor;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      notification: {
        create: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationProcessor, { provide: PrismaService, useValue: mockPrisma }],
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

      const created = { id: 'notif-1', status: NotificationStatus.DELIVERED, attempts: 1 };
      (prisma.notification.create as jest.Mock).mockResolvedValue(created);

      const result = await processor.process(job);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          transactionId: 'tx-1',
          channel: 'EMAIL',
          status: NotificationStatus.DELIVERED,
          recipient: 'user@example.com',
          payload: { type: 'DEPOSIT', amount: '100' },
          attempts: 1,
        },
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

      (prisma.notification.create as jest.Mock).mockResolvedValue({
        id: 'notif-2',
        status: NotificationStatus.DELIVERED,
        attempts: 3,
      });

      await processor.process(job);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          attempts: 3,
        }),
      });
    });

    it('should return already_delivered when P2002 unique violation is caught', async () => {
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

      (prisma.notification.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.0.0',
        }),
      );

      const result = await processor.process(job);
      expect(result).toEqual({ transactionId: 'tx-1', status: 'already_delivered' });
    });

    it('should re-throw non-P2002 errors', async () => {
      const job = {
        id: 'job-err',
        data: {
          transactionId: 'tx-1',
          channel: 'EMAIL',
          recipient: 'user@example.com',
          payload: {},
        },
        attemptsMade: 0,
      } as unknown as Job;

      (prisma.notification.create as jest.Mock).mockRejectedValue(new Error('DB connection lost'));

      await expect(processor.process(job)).rejects.toThrow('DB connection lost');
    });
  });

  describe('onFailed', () => {
    it('should NOT upsert record when attemptsMade < NOTIFICATION_MAX_ATTEMPTS', async () => {
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

      expect(prisma.notification.upsert).not.toHaveBeenCalled();
    });

    it('should upsert DEAD_LETTER record when attemptsMade >= NOTIFICATION_MAX_ATTEMPTS', async () => {
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
      (prisma.notification.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.notification.upsert as jest.Mock).mockResolvedValue({});

      await processor.onFailed(job, error);

      expect(prisma.notification.findUnique).toHaveBeenCalledWith({
        where: { transactionId_channel: { transactionId: 'tx-4', channel: 'EMAIL' } },
        select: { status: true },
      });
      expect(prisma.notification.upsert).toHaveBeenCalledWith({
        where: {
          transactionId_channel: { transactionId: 'tx-4', channel: 'EMAIL' },
        },
        create: {
          transactionId: 'tx-4',
          channel: 'EMAIL',
          status: NotificationStatus.DEAD_LETTER,
          recipient: 'user@example.com',
          payload: { type: 'WITHDRAWAL' },
          attempts: NOTIFICATION_MAX_ATTEMPTS,
          lastError: 'permanent failure',
        },
        update: {
          status: NotificationStatus.DEAD_LETTER,
          attempts: NOTIFICATION_MAX_ATTEMPTS,
          lastError: 'permanent failure',
        },
      });
    });

    it('should NOT overwrite DELIVERED notification with DEAD_LETTER', async () => {
      const job = {
        id: 'job-5',
        data: {
          transactionId: 'tx-5',
          channel: 'EMAIL',
          recipient: 'user@example.com',
          payload: {},
        },
        attemptsMade: NOTIFICATION_MAX_ATTEMPTS,
      } as unknown as Job;

      (prisma.notification.findUnique as jest.Mock).mockResolvedValue({
        status: NotificationStatus.DELIVERED,
      });

      await processor.onFailed(job, new Error('late failure'));

      expect(prisma.notification.upsert).not.toHaveBeenCalled();
    });
  });
});
