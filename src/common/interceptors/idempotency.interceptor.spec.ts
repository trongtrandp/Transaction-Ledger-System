import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  UnprocessableEntityException,
} from '@nestjs/common';
import { of, throwError, firstValueFrom } from 'rxjs';
import { createHash } from 'crypto';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyService } from '../../idempotency/idempotency.service';

// Helper to compute the same hash the interceptor uses
function expectedHash(body: unknown): string {
  // Import stableStringify indirectly by hashing through the interceptor's logic
  // We replicate stableStringify here to verify deterministic output
  function stableStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
    const sorted = Object.keys(obj as Record<string, unknown>)
      .filter((k) => (obj as Record<string, unknown>)[k] !== undefined)
      .sort();
    return '{' + sorted.map((k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k])).join(',') + '}';
  }
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

describe('stableStringify (via interceptor hashing)', () => {
  let interceptor: IdempotencyInterceptor;
  let mockIdempotencyService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockIdempotencyService = {
      checkAndAcquire: jest.fn().mockResolvedValue({ status: 'miss' }),
      store: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyInterceptor,
        { provide: IdempotencyService, useValue: mockIdempotencyService },
      ],
    }).compile();

    interceptor = module.get<IdempotencyInterceptor>(IdempotencyInterceptor);
  });

  function makeContext(body: unknown) {
    const mockCallHandler = { handle: jest.fn().mockReturnValue(of({ ok: true })) } as unknown as CallHandler;
    const ctx = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ headers: { 'idempotency-key': 'k1' }, body }),
        getResponse: jest.fn().mockReturnValue({ status: jest.fn(), statusCode: 201 }),
      }),
    } as unknown as ExecutionContext;
    return { ctx, mockCallHandler };
  }

  it('should produce same hash regardless of key order', async () => {
    const body1 = { b: 2, a: 1 };
    const body2 = { a: 1, b: 2 };

    const { ctx: ctx1, mockCallHandler: h1 } = makeContext(body1);
    await interceptor.intercept(ctx1, h1);
    const hash1 = mockIdempotencyService.checkAndAcquire.mock.calls[0][1];

    mockIdempotencyService.checkAndAcquire.mockClear();

    const { ctx: ctx2, mockCallHandler: h2 } = makeContext(body2);
    await interceptor.intercept(ctx2, h2);
    const hash2 = mockIdempotencyService.checkAndAcquire.mock.calls[0][1];

    expect(hash1).toBe(hash2);
  });

  it('should produce same hash for deeply nested objects with different key order', async () => {
    const body1 = { outer: { z: 3, a: 1 }, list: [1, 2] };
    const body2 = { list: [1, 2], outer: { a: 1, z: 3 } };

    const { ctx: ctx1, mockCallHandler: h1 } = makeContext(body1);
    await interceptor.intercept(ctx1, h1);
    const hash1 = mockIdempotencyService.checkAndAcquire.mock.calls[0][1];

    mockIdempotencyService.checkAndAcquire.mockClear();

    const { ctx: ctx2, mockCallHandler: h2 } = makeContext(body2);
    await interceptor.intercept(ctx2, h2);
    const hash2 = mockIdempotencyService.checkAndAcquire.mock.calls[0][1];

    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different values', async () => {
    const { ctx: ctx1, mockCallHandler: h1 } = makeContext({ a: 1 });
    await interceptor.intercept(ctx1, h1);
    const hash1 = mockIdempotencyService.checkAndAcquire.mock.calls[0][1];

    mockIdempotencyService.checkAndAcquire.mockClear();

    const { ctx: ctx2, mockCallHandler: h2 } = makeContext({ a: 2 });
    await interceptor.intercept(ctx2, h2);
    const hash2 = mockIdempotencyService.checkAndAcquire.mock.calls[0][1];

    expect(hash1).not.toBe(hash2);
  });

  it('should handle null body (coalesced to empty object)', async () => {
    const { ctx, mockCallHandler } = makeContext(null);
    await interceptor.intercept(ctx, mockCallHandler);
    // interceptor uses `request.body ?? {}`, so null becomes {}
    expect(mockIdempotencyService.checkAndAcquire).toHaveBeenCalledWith('k1', expectedHash({}));
  });

  it('should handle empty object', async () => {
    const { ctx, mockCallHandler } = makeContext({});
    await interceptor.intercept(ctx, mockCallHandler);
    expect(mockIdempotencyService.checkAndAcquire).toHaveBeenCalledWith('k1', expectedHash({}));
  });

  it('should handle arrays correctly', async () => {
    const { ctx, mockCallHandler } = makeContext([3, 1, 2]);
    await interceptor.intercept(ctx, mockCallHandler);
    expect(mockIdempotencyService.checkAndAcquire).toHaveBeenCalledWith('k1', expectedHash([3, 1, 2]));
  });

  it('should strip undefined values (matching JSON.stringify behavior)', async () => {
    const body1 = { a: 1, b: undefined };
    const body2 = { a: 1 };

    const { ctx: ctx1, mockCallHandler: h1 } = makeContext(body1);
    await interceptor.intercept(ctx1, h1);
    const hash1 = mockIdempotencyService.checkAndAcquire.mock.calls[0][1];

    mockIdempotencyService.checkAndAcquire.mockClear();

    const { ctx: ctx2, mockCallHandler: h2 } = makeContext(body2);
    await interceptor.intercept(ctx2, h2);
    const hash2 = mockIdempotencyService.checkAndAcquire.mock.calls[0][1];

    expect(hash1).toBe(hash2);
  });
});

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;

  const mockIdempotencyService = {
    checkAndAcquire: jest.fn(),
    store: jest.fn(),
    release: jest.fn(),
  };

  const mockRequest = {
    headers: { 'idempotency-key': 'test-key' },
    body: { amount: 100 },
  };

  const mockResponse = {
    status: jest.fn(),
    statusCode: 201,
  };

  const mockContext = {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(mockRequest),
      getResponse: jest.fn().mockReturnValue(mockResponse),
    }),
  } as unknown as ExecutionContext;

  const mockCallHandler = {
    handle: jest.fn(),
  } as unknown as CallHandler;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockRequest.headers = { 'idempotency-key': 'test-key' };
    mockRequest.body = { amount: 100 };
    mockResponse.statusCode = 201;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyInterceptor,
        { provide: IdempotencyService, useValue: mockIdempotencyService },
      ],
    }).compile();

    interceptor = module.get<IdempotencyInterceptor>(IdempotencyInterceptor);
  });
  it('should throw BadRequestException when Idempotency-Key header is missing', async () => {
    mockRequest.headers = {} as any;

    await expect(interceptor.intercept(mockContext, mockCallHandler)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should throw UnprocessableEntityException when checkAndAcquire returns hash_mismatch', async () => {
    mockIdempotencyService.checkAndAcquire.mockResolvedValue({ status: 'hash_mismatch' });

    await expect(interceptor.intercept(mockContext, mockCallHandler)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('should throw ConflictException when checkAndAcquire returns in_progress', async () => {
    mockIdempotencyService.checkAndAcquire.mockResolvedValue({ status: 'in_progress' });

    await expect(interceptor.intercept(mockContext, mockCallHandler)).rejects.toThrow(
      ConflictException,
    );
  });

  it('should set response status and return cached response when checkAndAcquire returns cached', async () => {
    const cachedResponse = { id: 1, status: 'completed' };
    mockIdempotencyService.checkAndAcquire.mockResolvedValue({
      status: 'cached',
      statusCode: 200,
      response: cachedResponse,
    });

    const result$ = await interceptor.intercept(mockContext, mockCallHandler);
    const result = await firstValueFrom(result$);

    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(result).toEqual(cachedResponse);
    expect(mockCallHandler.handle).not.toHaveBeenCalled();
  });

  it('should call next.handle(), store response, and return body on cache miss', async () => {
    const responseBody = { id: 1, status: 'created' };
    mockIdempotencyService.checkAndAcquire.mockResolvedValue({ status: 'miss' });
    mockIdempotencyService.store.mockResolvedValue(undefined);
    mockCallHandler.handle = jest.fn().mockReturnValue(of(responseBody));

    const result$ = await interceptor.intercept(mockContext, mockCallHandler);
    const result = await firstValueFrom(result$);

    expect(mockCallHandler.handle).toHaveBeenCalled();
    expect(mockIdempotencyService.store).toHaveBeenCalledWith(
      'test-key',
      expect.any(String),
      201,
      responseBody,
    );
    expect(result).toEqual(responseBody);
  });

  it('should log error but still return response body when store() fails', async () => {
    const responseBody = { id: 1, status: 'created' };
    mockIdempotencyService.checkAndAcquire.mockResolvedValue({ status: 'miss' });
    mockIdempotencyService.store.mockRejectedValue(new Error('Redis write failed'));
    mockCallHandler.handle = jest.fn().mockReturnValue(of(responseBody));

    const result$ = await interceptor.intercept(mockContext, mockCallHandler);
    const result = await firstValueFrom(result$);

    expect(result).toEqual(responseBody);
  });

  it('should call release() and re-throw when next.handle() throws', async () => {
    const handlerError = new Error('handler error');
    mockIdempotencyService.checkAndAcquire.mockResolvedValue({ status: 'miss' });
    mockIdempotencyService.release.mockResolvedValue(undefined);
    mockCallHandler.handle = jest.fn().mockReturnValue(throwError(() => handlerError));

    const result$ = await interceptor.intercept(mockContext, mockCallHandler);

    await expect(firstValueFrom(result$)).rejects.toThrow('handler error');
    expect(mockIdempotencyService.release).toHaveBeenCalledWith('test-key');
  });

  it('should still re-throw original error when release() fails after next.handle() throws', async () => {
    const handlerError = new Error('handler error');
    mockIdempotencyService.checkAndAcquire.mockResolvedValue({ status: 'miss' });
    mockIdempotencyService.release.mockRejectedValue(new Error('release failed'));
    mockCallHandler.handle = jest.fn().mockReturnValue(throwError(() => handlerError));

    const result$ = await interceptor.intercept(mockContext, mockCallHandler);

    await expect(firstValueFrom(result$)).rejects.toThrow('handler error');
    expect(mockIdempotencyService.release).toHaveBeenCalledWith('test-key');
  });

});
