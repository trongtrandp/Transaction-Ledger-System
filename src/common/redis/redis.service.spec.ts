import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const mockRedisInstance = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  quit: jest.fn(),
};

jest.mock('ioredis', () => {
  const MockRedis = jest.fn().mockImplementation(() => mockRedisInstance);
  return { __esModule: true, default: MockRedis };
});

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'REDIS_HOST') return 'localhost';
              if (key === 'REDIS_PORT') return 6379;
              throw new Error(`Unknown key: ${key}`);
            }),
          },
        },
      ],
    }).compile();

    service = module.get(RedisService);
  });

  describe('get', () => {
    it('should return value from redis client', async () => {
      mockRedisInstance.get.mockResolvedValue('bar');

      const result = await service.get('foo');

      expect(result).toBe('bar');
      expect(mockRedisInstance.get).toHaveBeenCalledWith('foo');
    });
  });

  describe('set', () => {
    it('should call client.set(key, value) without TTL', async () => {
      mockRedisInstance.set.mockResolvedValue('OK');

      await service.set('key1', 'value1');

      expect(mockRedisInstance.set).toHaveBeenCalledWith('key1', 'value1');
    });

    it('should call client.set(key, value, EX, ttl) with TTL', async () => {
      mockRedisInstance.set.mockResolvedValue('OK');

      await service.set('key1', 'value1', 60);

      expect(mockRedisInstance.set).toHaveBeenCalledWith('key1', 'value1', 'EX', 60);
    });
  });

  describe('setNX', () => {
    it('should return true when client returns OK', async () => {
      mockRedisInstance.set.mockResolvedValue('OK');

      const result = await service.setNX('lock', '1', 30);

      expect(result).toBe(true);
      expect(mockRedisInstance.set).toHaveBeenCalledWith('lock', '1', 'EX', 30, 'NX');
    });

    it('should return false when client returns null', async () => {
      mockRedisInstance.set.mockResolvedValue(null);

      const result = await service.setNX('lock', '1', 30);

      expect(result).toBe(false);
      expect(mockRedisInstance.set).toHaveBeenCalledWith('lock', '1', 'EX', 30, 'NX');
    });
  });

  describe('del', () => {
    it('should call client.del', async () => {
      mockRedisInstance.del.mockResolvedValue(1);

      await service.del('key1');

      expect(mockRedisInstance.del).toHaveBeenCalledWith('key1');
    });
  });

  describe('onModuleDestroy', () => {
    it('should call client.quit', async () => {
      mockRedisInstance.quit.mockResolvedValue('OK');

      await service.onModuleDestroy();

      expect(mockRedisInstance.quit).toHaveBeenCalled();
    });
  });
});
