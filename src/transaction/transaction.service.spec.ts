import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TRANSACTION_QUEUE, PROCESS_TRANSACTION_JOB } from '../common/constants/queue.constants';

describe('TransactionService', () => {
  let service: TransactionService;
  let prisma: jest.Mocked<PrismaService>;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    const mockQueue = { add: jest.fn() };
    const mockPrisma = {
      transaction: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        { provide: getQueueToken(TRANSACTION_QUEUE), useValue: mockQueue },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(TransactionService);
    prisma = module.get(PrismaService);
    queue = mockQueue;
  });

  describe('createTransaction', () => {
    it('should create DB record, enqueue job, and return QUEUED status', async () => {
      const created = { id: expect.any(String), status: 'QUEUED' };
      (prisma.transaction.create as jest.Mock).mockResolvedValue(created);
      queue.add.mockResolvedValue({});

      const result = await service.createTransaction({
        type: 'DEPOSIT' as never,
        amount: '100.50',
        currency: 'USD',
      });

      expect(result.status).toBe('QUEUED');
      expect(result.id).toBeDefined();
      expect(prisma.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'DEPOSIT',
          status: 'QUEUED',
          currency: 'USD',
        }),
      });
      expect(queue.add).toHaveBeenCalledWith(PROCESS_TRANSACTION_JOB, expect.objectContaining({
        transactionId: result.id,
        type: 'DEPOSIT',
        amount: '100.50',
        currency: 'USD',
      }));
    });
  });

  describe('findById', () => {
    it('should return transaction when found', async () => {
      const tx = { id: 'uuid-1', type: 'DEPOSIT', status: 'COMPLETED' };
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(tx);

      const result = await service.findById('uuid-1');
      expect(result).toEqual(tx);
    });

    it('should throw NotFoundException when not found', async () => {
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('uuid-missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.transaction.count as jest.Mock).mockResolvedValue(0);

      const result = await service.findAll({ page: 1, limit: 20 });
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });

    it('should apply filters', async () => {
      (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.transaction.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 10, status: 'COMPLETED' as never, type: 'DEPOSIT' as never });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'COMPLETED', type: 'DEPOSIT' }),
        }),
      );
    });
  });
});
