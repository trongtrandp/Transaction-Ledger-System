import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';

@Module({
  providers: [IdempotencyService, IdempotencyInterceptor],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
