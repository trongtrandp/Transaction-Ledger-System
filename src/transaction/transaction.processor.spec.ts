jest.mock('../generated/prisma/client', () => ({
  TransactionStatus: {
    COMPLETED: 'COMPLETED',
    PROCESSING: 'PROCESSING',
    QUEUED: 'QUEUED',
    FAILED: 'FAILED',
  },
  NotificationChannel: { EMAIL: 'EMAIL' },
  Prisma: { Decimal: jest.fn().mockImplementation((val) => ({ toString: () => val })) },
  PrismaClient: class PrismaClientMock {},
}));

jest.mock('../common/prisma/prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({})),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { TransactionProcessor } from './transaction.processor';
import { PrismaService } from '../common/prisma/prisma.service';
import { NOTIFICATION_QUEUE, SEND_NOTIFICATION_JOB } from '../common/constants/queue.constants';
import { TransactionStatus, NotificationChannel } from '../generated/prisma/client';
import { Job } from 'bullmq';

describe('TransactionProcessor', () => {
  let processor: TransactionProcessor;
  let prisma: jest.Mocked<PrismaService>;
  let notificationQueue: { add: jest.Mock };

  beforeEach(async () => {
    const mockQueue = { add: jest.fn() };
    const mockPrisma = {
      transaction: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionProcessor,
        { provide: getQueueToken(NOTIFICATION_QUEUE), useValue: mockQueue },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    processor = module.get(TransactionProcessor);
    prisma = module.get(PrismaService);
    notificationQueue = mockQueue;
  });

  describe('process', () => {
    const baseJobData = {
      transactionId: 'tx-1',
      type: 'DEPOSIT',
      amount: '100.50',
      currency: 'USD',
      fromAccount: 'acc-from',
      toAccount: 'acc-to',
      metadata: null,
    };

    it('should enqueue notification with deterministic jobId when already COMPLETED', async () => {
      const existing = {
        id: 'tx-1',
        type: 'DEPOSIT',
        status: TransactionStatus.COMPLETED,
        amount: { toString: () => '100.50' },
        currency: 'USD',
      };
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(existing);
      notificationQueue.add.mockResolvedValue({});

      const job = { id: 'job-1', data: baseJobData, attemptsMade: 0 } as unknown as Job;
      const result = await processor.process(job);

      expect(result).toEqual(existing);
      expect(notificationQueue.add).toHaveBeenCalledWith(
        SEND_NOTIFICATION_JOB,
        expect.objectContaining({ transactionId: 'tx-1', channel: NotificationChannel.EMAIL }),
        { jobId: 'notif-tx-1' },
      );
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it('should skip when transaction not found in DB', async () => {
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(null);

      const job = { id: 'job-2', data: baseJobData, attemptsMade: 0 } as unknown as Job;
      const result = await processor.process(job);

      expect(result).toBeUndefined();
      expect(prisma.transaction.update).not.toHaveBeenCalled();
      expect(notificationQueue.add).not.toHaveBeenCalled();
    });

    it('should updateMany and complete when existing is QUEUED/FAILED', async () => {
      const existing = { id: 'tx-1', status: TransactionStatus.QUEUED };
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(existing);
      (prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const completed = {
        id: 'tx-1',
        type: 'DEPOSIT',
        status: TransactionStatus.COMPLETED,
        amount: { toString: () => '100.50' },
        currency: 'USD',
      };
      (prisma.transaction.update as jest.Mock).mockResolvedValue(completed);
      notificationQueue.add.mockResolvedValue({});

      const job = { id: 'job-3', data: baseJobData, attemptsMade: 1 } as unknown as Job;
      const result = await processor.process(job);

      expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'tx-1',
          status: { in: [TransactionStatus.QUEUED, TransactionStatus.FAILED] },
        },
        data: { status: TransactionStatus.PROCESSING },
      });
      expect(prisma.transaction.update).toHaveBeenCalled();
      expect(result).toEqual(completed);
    });

    it('should return existing when updateMany returns count 0 (race condition guard)', async () => {
      const existing = { id: 'tx-1', status: TransactionStatus.PROCESSING };
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(existing);
      (prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const job = { id: 'job-4', data: baseJobData, attemptsMade: 0 } as unknown as Job;
      const result = await processor.process(job);

      expect(result).toEqual(existing);
      expect(prisma.transaction.update).not.toHaveBeenCalled();
      expect(notificationQueue.add).not.toHaveBeenCalled();
    });

    it('should skip notification when both fromAccount and toAccount are undefined', async () => {
      const existing = { id: 'tx-1', status: TransactionStatus.QUEUED };
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(existing);
      (prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const completed = {
        id: 'tx-1',
        type: 'DEPOSIT',
        status: TransactionStatus.COMPLETED,
        amount: { toString: () => '50' },
        currency: 'EUR',
      };
      (prisma.transaction.update as jest.Mock).mockResolvedValue(completed);

      const jobData = { ...baseJobData, fromAccount: undefined, toAccount: undefined };
      const job = { id: 'job-5', data: jobData, attemptsMade: 0 } as unknown as Job;
      await processor.process(job);

      expect(notificationQueue.add).not.toHaveBeenCalled();
    });

    it('should use fromAccount as recipient when both are provided', async () => {
      const existing = { id: 'tx-1', status: TransactionStatus.QUEUED };
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(existing);
      (prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const completed = {
        id: 'tx-1',
        type: 'DEPOSIT',
        status: TransactionStatus.COMPLETED,
        amount: { toString: () => '100.50' },
        currency: 'USD',
      };
      (prisma.transaction.update as jest.Mock).mockResolvedValue(completed);
      notificationQueue.add.mockResolvedValue({});

      const job = { id: 'job-6', data: baseJobData, attemptsMade: 0 } as unknown as Job;
      await processor.process(job);

      expect(notificationQueue.add).toHaveBeenCalledWith(
        SEND_NOTIFICATION_JOB,
        expect.objectContaining({ recipient: 'acc-from' }),
        { jobId: 'notif-tx-1' },
      );
    });

    it('should use toAccount as fallback when fromAccount is undefined', async () => {
      const existing = { id: 'tx-1', status: TransactionStatus.QUEUED };
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(existing);
      (prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const completed = {
        id: 'tx-1',
        type: 'DEPOSIT',
        status: TransactionStatus.COMPLETED,
        amount: { toString: () => '200' },
        currency: 'GBP',
      };
      (prisma.transaction.update as jest.Mock).mockResolvedValue(completed);
      notificationQueue.add.mockResolvedValue({});

      const jobData = { ...baseJobData, fromAccount: undefined, toAccount: 'acc-to' };
      const job = { id: 'job-7', data: jobData, attemptsMade: 0 } as unknown as Job;
      await processor.process(job);

      expect(notificationQueue.add).toHaveBeenCalledWith(
        SEND_NOTIFICATION_JOB,
        expect.objectContaining({ recipient: 'acc-to' }),
        { jobId: 'notif-tx-1' },
      );
    });
  });

  describe('onFailed', () => {
    it('should update transaction to FAILED status', async () => {
      (prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const job = {
        id: 'job-8',
        data: { transactionId: 'tx-fail' },
        attemptsMade: 1,
      } as unknown as Job;
      await processor.onFailed(job, new Error('processing error'));

      expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
        where: { id: 'tx-fail', status: { not: TransactionStatus.COMPLETED } },
        data: { status: TransactionStatus.FAILED },
      });
    });

    it('should not re-throw when updateMany throws', async () => {
      (prisma.transaction.updateMany as jest.Mock).mockRejectedValue(new Error('db down'));

      const job = {
        id: 'job-9',
        data: { transactionId: 'tx-err' },
        attemptsMade: 2,
      } as unknown as Job;
      await expect(processor.onFailed(job, new Error('fail'))).resolves.not.toThrow();
    });

    it('should call updateMany with where clause excluding COMPLETED status', async () => {
      (prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const job = {
        id: 'job-10',
        data: { transactionId: 'tx-done' },
        attemptsMade: 1,
      } as unknown as Job;
      await processor.onFailed(job, new Error('some error'));

      expect(prisma.transaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: TransactionStatus.COMPLETED },
          }),
        }),
      );
    });
  });
});
