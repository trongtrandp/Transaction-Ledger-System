import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

const mockConnect = jest.fn();
const mockDisconnect = jest.fn();

const mockPoolEnd = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ end: mockPoolEnd })),
}));
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../generated/prisma/client', () => {
  return {
    PrismaClient: class MockPrismaClient {
      $connect = mockConnect;
      $disconnect = mockDisconnect;
      constructor(_opts?: unknown) {}
    },
  };
});

import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'DATABASE_URL') return 'postgresql://localhost:5432/test';
              if (key === 'DB_POOL_SIZE') return defaultValue ?? 20;
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(PrismaService);
  });

  describe('onModuleInit', () => {
    it('should call $connect', async () => {
      await service.onModuleInit();

      expect(mockConnect).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should call $disconnect and pool.end()', async () => {
      await service.onModuleDestroy();

      expect(mockDisconnect).toHaveBeenCalled();
      expect(mockPoolEnd).toHaveBeenCalled();
    });
  });
});
