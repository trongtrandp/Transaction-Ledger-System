import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  UnprocessableEntityException,
} from '@nestjs/common';
import { of, throwError, firstValueFrom } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyService } from '../../idempotency/idempotency.service';

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
