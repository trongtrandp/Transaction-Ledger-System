import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { PrismaService } from '../common/prisma/prisma.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      notification: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(NotificationService);
    prisma = module.get(PrismaService);
  });

  describe('findById', () => {
    it('should return notification with transaction', async () => {
      const notification = {
        id: 'notif-1',
        status: 'DELIVERED',
        transaction: { id: 'tx-1' },
      };
      (prisma.notification.findUnique as jest.Mock).mockResolvedValue(notification);

      const result = await service.findById('notif-1');
      expect(result).toEqual(notification);
      expect(prisma.notification.findUnique).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        include: { transaction: true },
      });
    });

    it('should throw NotFoundException when not found', async () => {
      (prisma.notification.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('notif-missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.notification.count as jest.Mock).mockResolvedValue(0);

      const result = await service.findAll({ page: 1, limit: 20 });
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });

    it('should apply status and channel filters', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.notification.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({
        page: 1,
        limit: 10,
        status: 'DELIVERED' as never,
        channel: 'EMAIL' as never,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'DELIVERED', channel: 'EMAIL' }),
        }),
      );
    });
  });
});
