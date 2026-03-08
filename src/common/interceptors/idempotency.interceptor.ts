import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Observable, of, from, throwError, switchMap, catchError } from 'rxjs';
import { createHash } from 'crypto';
import { IdempotencyService } from '../../idempotency/idempotency.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly idempotencyService: IdempotencyService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const requestHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? {}))
      .digest('hex');

    const result = await this.idempotencyService.checkAndAcquire(idempotencyKey, requestHash);

    if (result.status === 'hash_mismatch') {
      throw new UnprocessableEntityException(
        'Idempotency-Key already used with a different request body',
      );
    }

    if (result.status === 'in_progress') {
      throw new ConflictException('Request with this Idempotency-Key is already being processed');
    }

    if (result.status === 'cached') {
      const response = context.switchToHttp().getResponse();
      response.status(result.statusCode);
      return of(result.response);
    }

    // NestJS best practice: pipe RxJS operators on next.handle() Observable stream
    return next.handle().pipe(
      switchMap((responseBody) => {
        const response = context.switchToHttp().getResponse();
        return from(
          this.idempotencyService.store(idempotencyKey, requestHash, response.statusCode, responseBody),
        ).pipe(
          switchMap(() => of(responseBody)),
          catchError((storeErr) => {
            // store() failed, but the transaction is already created and queued.
            // Keep the idempotency placeholder record (no statusCode) so retries
            // see 'in_progress' instead of treating it as a new request.
            this.logger.error(`Failed to store idempotency response for key ${idempotencyKey}: ${storeErr}`);
            return of(responseBody);
          }),
        );
      }),
      catchError((err) =>
        from(this.idempotencyService.release(idempotencyKey)).pipe(
          switchMap(() => throwError(() => err)),
          catchError(() => throwError(() => err)),
        ),
      ),
    );
  }
}
