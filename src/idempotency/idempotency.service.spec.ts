import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IdempotencyService } from './idempotency.service';
import { RedisService } from '../common/redis/redis.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let redis: jest.Mocked<RedisService>;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      setNX: jest.fn(),
      del: jest.fn(),
    };

    const mockPrisma = {
      idempotencyRecord: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        { provide: RedisService, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: (key: string, defaultVal: unknown) => defaultVal ?? 24 } },
      ],
    }).compile();

    service = module.get(IdempotencyService);
    redis = module.get(RedisService);
    prisma = module.get(PrismaService);
  });

  describe('checkAndAcquire', () => {
    it('should return miss and acquire lock when key is new', async () => {
      redis.setNX.mockResolvedValue(true);
      (prisma.idempotencyRecord.create as jest.Mock).mockResolvedValue({});

      const result = await service.checkAndAcquire('key-1', 'hash-abc');
      expect(result.status).toBe('miss');
      expect(redis.setNX).toHaveBeenCalled();
      expect(prisma.idempotencyRecord.create).toHaveBeenCalled();
    });

    it('should return cached when Redis has completed entry', async () => {
      redis.setNX.mockResolvedValue(false);
      redis.get.mockResolvedValue(
        JSON.stringify({ requestHash: 'hash-abc', statusCode: 202, response: { id: '1' } }),
      );

      const result = await service.checkAndAcquire('key-1', 'hash-abc');
      expect(result.status).toBe('cached');
      expect(result.statusCode).toBe(202);
      expect(result.response).toEqual({ id: '1' });
    });

    it('should return in_progress when Redis has entry without statusCode', async () => {
      redis.setNX.mockResolvedValue(false);
      redis.get.mockResolvedValue(JSON.stringify({ requestHash: 'hash-abc' }));

      const result = await service.checkAndAcquire('key-1', 'hash-abc');
      expect(result.status).toBe('in_progress');
    });

    it('should return hash_mismatch when hash differs', async () => {
      redis.setNX.mockResolvedValue(false);
      redis.get.mockResolvedValue(
        JSON.stringify({ requestHash: 'hash-different', statusCode: 202, response: {} }),
      );

      const result = await service.checkAndAcquire('key-1', 'hash-abc');
      expect(result.status).toBe('hash_mismatch');
    });

    it('should fallback to DB when Redis lock fails and Redis cache misses', async () => {
      redis.setNX.mockResolvedValue(false);
      redis.get.mockResolvedValue(null);
      (prisma.idempotencyRecord.findUnique as jest.Mock).mockResolvedValue({
        key: 'key-1',
        requestHash: 'hash-abc',
        statusCode: 202,
        response: { id: '1' },
        expiresAt: new Date(Date.now() + 86400_000),
      });

      const result = await service.checkAndAcquire('key-1', 'hash-abc');
      expect(result.status).toBe('cached');
      expect(redis.set).toHaveBeenCalled();
    });

    it('should rollback Redis lock on DB unique constraint violation', async () => {
      redis.setNX.mockResolvedValue(true);
      (prisma.idempotencyRecord.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.0.0',
        }),
      );
      // After rollback, goes straight to DB (skips Redis since we just deleted it)
      (prisma.idempotencyRecord.findUnique as jest.Mock).mockResolvedValue({
        key: 'key-1',
        requestHash: 'hash-abc',
        statusCode: 202,
        response: { id: '1' },
        expiresAt: new Date(Date.now() + 86400_000),
      });

      const result = await service.checkAndAcquire('key-1', 'hash-abc');
      expect(redis.del).toHaveBeenCalled();
      expect(result.status).toBe('cached');
    });

    it('should handle corrupted Redis data gracefully', async () => {
      redis.setNX.mockResolvedValue(false);
      redis.get.mockResolvedValue('not-valid-json{{{');

      const result = await service.checkAndAcquire('key-1', 'hash-abc');
      expect(result.status).toBe('in_progress');
    });

    it('should cleanup and return in_progress for expired DB record', async () => {
      redis.setNX.mockResolvedValue(false);
      redis.get.mockResolvedValue(null);
      (prisma.idempotencyRecord.findUnique as jest.Mock).mockResolvedValue({
        key: 'key-1',
        requestHash: 'hash-abc',
        statusCode: 202,
        response: { id: '1' },
        expiresAt: new Date(Date.now() - 3600_000), // expired 1 hour ago
      });
      (prisma.idempotencyRecord.delete as jest.Mock).mockResolvedValue({});
      redis.del.mockResolvedValue(undefined);

      const result = await service.checkAndAcquire('key-1', 'hash-abc');
      expect(result.status).toBe('in_progress');
      expect(prisma.idempotencyRecord.delete).toHaveBeenCalledWith({ where: { key: 'key-1' } });
      expect(redis.del).toHaveBeenCalledWith('idempotency:key-1');
    });

    it('should rollback Redis and re-throw on non-P2002 DB error during acquire', async () => {
      redis.setNX.mockResolvedValue(true);
      const dbError = new Error('DB connection lost');
      (prisma.idempotencyRecord.create as jest.Mock).mockRejectedValue(dbError);
      redis.del.mockResolvedValue(undefined);

      await expect(service.checkAndAcquire('key-1', 'hash-abc')).rejects.toThrow('DB connection lost');
      expect(redis.del).toHaveBeenCalledWith('idempotency:key-1');
    });
  });

  describe('store', () => {
    it('should store response in both Redis and DB', async () => {
      (prisma.idempotencyRecord.update as jest.Mock).mockResolvedValue({});
      redis.set.mockResolvedValue(undefined);

      await service.store('key-1', 'hash-abc', 202, { id: '1' });

      expect(redis.set).toHaveBeenCalled();
      expect(prisma.idempotencyRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'key-1' },
          data: { statusCode: 202, response: { id: '1' } },
        }),
      );
    });
  });

  describe('release', () => {
    it('should delete DB record first, then Redis key', async () => {
      const callOrder: string[] = [];
      (prisma.idempotencyRecord.delete as jest.Mock).mockImplementation(() => {
        callOrder.push('db');
        return Promise.resolve({});
      });
      redis.del.mockImplementation(() => {
        callOrder.push('redis');
        return Promise.resolve(undefined) as any;
      });

      await service.release('key-1');

      expect(prisma.idempotencyRecord.delete).toHaveBeenCalledWith({ where: { key: 'key-1' } });
      expect(redis.del).toHaveBeenCalledWith('idempotency:key-1');
      expect(callOrder).toEqual(['db', 'redis']);
    });

    it('should not throw if DB record does not exist', async () => {
      (prisma.idempotencyRecord.delete as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '6.0.0',
        }),
      );
      redis.del.mockResolvedValue(undefined);

      await expect(service.release('key-missing')).resolves.not.toThrow();
      expect(redis.del).toHaveBeenCalled();
    });

    it('should still delete Redis key when DB delete fails with non-P2025 error', async () => {
      (prisma.idempotencyRecord.delete as jest.Mock).mockRejectedValue(new Error('DB connection lost'));
      redis.del.mockResolvedValue(undefined);

      await expect(service.release('key-1')).resolves.not.toThrow();
      expect(redis.del).toHaveBeenCalledWith('idempotency:key-1');
    });
  });

  describe('stale placeholder handling', () => {
    it('should return in_progress for recent placeholder without statusCode', async () => {
      redis.setNX.mockResolvedValue(false);
      redis.get.mockResolvedValue(null);
      (prisma.idempotencyRecord.findUnique as jest.Mock).mockResolvedValue({
        key: 'key-1',
        requestHash: 'hash-abc',
        statusCode: null,
        createdAt: new Date(), // just created
        expiresAt: new Date(Date.now() + 86400_000),
      });

      const result = await service.checkAndAcquire('key-1', 'hash-abc');
      expect(result.status).toBe('in_progress');
    });

    it('should return in_progress for stale placeholder (no unsafe cleanup)', async () => {
      redis.setNX.mockResolvedValue(false);
      redis.get.mockResolvedValue(null);
      (prisma.idempotencyRecord.findUnique as jest.Mock).mockResolvedValue({
        key: 'key-1',
        requestHash: 'hash-abc',
        statusCode: null,
        createdAt: new Date(Date.now() - 120_000), // 2 minutes old
        expiresAt: new Date(Date.now() + 86400_000),
      });

      const result = await service.checkAndAcquire('key-1', 'hash-abc');
      expect(result.status).toBe('in_progress');
      expect(prisma.idempotencyRecord.delete).not.toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredRecords', () => {
    it('should delete expired records and return count', async () => {
      (prisma.idempotencyRecord.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });

      const result = await service.cleanupExpiredRecords();

      expect(result).toBe(5);
      expect(prisma.idempotencyRecord.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lte: expect.any(Date) } },
      });
    });

    it('should return 0 when no expired records exist', async () => {
      (prisma.idempotencyRecord.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      const result = await service.cleanupExpiredRecords();

      expect(result).toBe(0);
    });
  });
});
