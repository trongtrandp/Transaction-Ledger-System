import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../common/redis/redis.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';

export interface IdempotencyCheckResult {
  status: 'miss' | 'in_progress' | 'cached' | 'hash_mismatch';
  statusCode?: number;
  response?: unknown;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly ttlSeconds: number;

  // Placeholder rows older than this are considered abandoned (store() or release() failed)
  private static readonly STALE_THRESHOLD_MS = 60_000;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const ttlHours = this.configService.get<number>('IDEMPOTENCY_TTL_HOURS', 24);
    this.ttlSeconds = ttlHours * 3600;
  }

  private redisKey(key: string) {
    return `idempotency:${key}`;
  }

  /**
   * Atomically check and acquire an idempotency lock.
   * Tries to acquire first (atomic), then inspects existing state on failure.
   * Eliminates TOCTOU race between separate check() and acquire() calls.
   */
  async checkAndAcquire(key: string, requestHash: string): Promise<IdempotencyCheckResult> {
    const placeholder = JSON.stringify({ requestHash });

    // Try atomic acquire via Redis SET NX
    const acquired = await this.redis.setNX(this.redisKey(key), placeholder, this.ttlSeconds);
    if (acquired) {
      // Redis lock acquired — now insert PostgreSQL placeholder
      try {
        await this.prisma.idempotencyRecord.create({
          data: { key, requestHash },
        });
        return { status: 'miss' }; // Lock acquired, proceed with request
      } catch (error: unknown) {
        // Unique constraint violation → another process inserted first
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          await this.redis.del(this.redisKey(key));
          // Skip Redis (just deleted) — go straight to DB
          return this.inspectFromDb(key, requestHash);
        } else {
          await this.redis.del(this.redisKey(key));
          throw error;
        }
      }
    }

    // Lock not acquired — inspect existing state
    return this.inspectExisting(key, requestHash);
  }

  /** Inspect existing idempotency state from Redis or PostgreSQL. */
  private async inspectExisting(key: string, requestHash: string): Promise<IdempotencyCheckResult> {
    const cached = await this.redis.get(this.redisKey(key));
    if (cached) {
      return this.parseIdempotencyData(cached, requestHash);
    }
    return this.inspectFromDb(key, requestHash);
  }

  /** Inspect existing idempotency state from PostgreSQL only. */
  private async inspectFromDb(key: string, requestHash: string): Promise<IdempotencyCheckResult> {
    const record = await this.prisma.idempotencyRecord.findUnique({ where: { key } });
    if (!record) {
      // Redis lock exists but DB record missing — likely mid-insert race or DB insert failed
      return { status: 'in_progress' };
    }

    if (record.requestHash !== requestHash) {
      return { status: 'hash_mismatch' };
    }
    if (!record.statusCode) {
      // Placeholder with no response — check if it's stale (store() or release() failed).
      // If older than threshold, clean up and allow retry rather than blocking forever.
      const ageMs = Date.now() - record.createdAt.getTime();
      if (ageMs > IdempotencyService.STALE_THRESHOLD_MS) {
        this.logger.warn(`Stale idempotency placeholder for key ${key} (${ageMs}ms old), releasing for retry`);
        await this.forceCleanup(key);
        return { status: 'miss' };
      }
      return { status: 'in_progress' };
    }

    // Re-populate Redis cache
    const data = JSON.stringify({
      requestHash: record.requestHash,
      statusCode: record.statusCode,
      response: record.response,
    });
    await this.redis.set(this.redisKey(key), data, this.ttlSeconds);

    return { status: 'cached', statusCode: record.statusCode, response: record.response };
  }

  /** Safely parse Redis idempotency data with error handling. */
  private parseIdempotencyData(raw: string, requestHash: string): IdempotencyCheckResult {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.requestHash !== requestHash) {
        return { status: 'hash_mismatch' };
      }
      if (!parsed.statusCode) {
        return { status: 'in_progress' };
      }
      return { status: 'cached', statusCode: parsed.statusCode, response: parsed.response };
    } catch {
      // Corrupted Redis data — treat as in_progress (lock exists but data is bad)
      this.logger.warn(`Corrupted idempotency data in Redis for key, treating as in_progress`);
      return { status: 'in_progress' };
    }
  }

  /** Store the final response for a completed idempotent request. */
  async store(
    key: string,
    requestHash: string,
    statusCode: number,
    response: unknown,
  ): Promise<void> {
    // DB first — if this fails, we don't want stale cached data in Redis
    await this.prisma.idempotencyRecord.update({
      where: { key },
      data: { statusCode, response: response as object },
    });

    const data = JSON.stringify({ requestHash, statusCode, response });
    await this.redis.set(this.redisKey(key), data, this.ttlSeconds);
  }

  /** Release idempotency lock on request failure so the key can be retried. */
  async release(key: string): Promise<void> {
    // DB first (durable store), then Redis (has TTL as safety net).
    // Both run independently so one failure doesn't prevent the other.
    try {
      await this.prisma.idempotencyRecord.delete({ where: { key } });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        // Record doesn't exist — fine
      } else {
        this.logger.warn(`Failed to delete idempotency record ${key}: ${error}`);
      }
    }
    try {
      await this.redis.del(this.redisKey(key));
    } catch (error: unknown) {
      this.logger.warn(`Failed to delete idempotency Redis key ${key}: ${error}`);
    }
  }

  /** Force-clean both Redis and DB for an abandoned placeholder. */
  private async forceCleanup(key: string): Promise<void> {
    try {
      await this.prisma.idempotencyRecord.delete({ where: { key } });
    } catch {
      // Best-effort — staleness check will retry on next request
    }
    try {
      await this.redis.del(this.redisKey(key));
    } catch {
      // Redis key has TTL, will expire eventually
    }
  }
}
