import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiHeader, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { TransactionService } from './transaction.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';

@ApiTags('Transactions')
@Controller('transactions')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 202, description: 'Transaction queued for processing' })
  @ApiResponse({ status: 409, description: 'Duplicate request in progress' })
  @ApiResponse({ status: 422, description: 'Idempotency key reused with different body' })
  create(@Body() dto: CreateTransactionDto) {
    return this.transactionService.createTransaction(dto);
  }

  @Get(':id')
  @SkipThrottle()
  @ApiResponse({ status: 200, description: 'Transaction details' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactionService.findById(id);
  }

  @Get()
  @SkipThrottle()
  @ApiResponse({ status: 200, description: 'Paginated transaction list' })
  findAll(@Query() query: ListTransactionsQueryDto) {
    return this.transactionService.findAll(query);
  }
}
