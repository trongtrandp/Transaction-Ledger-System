import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { TRANSACTION_QUEUE, PROCESS_TRANSACTION_JOB } from '../common/constants/queue.constants';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { Prisma, TransactionStatus } from '../generated/prisma/client';
import { randomUUID } from 'crypto';

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    @InjectQueue(TRANSACTION_QUEUE) private readonly transactionQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async createTransaction(dto: CreateTransactionDto) {
    const transactionId = randomUUID();

    // Persist record first so GET /transactions/:id never returns 404
    const transaction = await this.prisma.transaction.create({
      data: {
        id: transactionId,
        type: dto.type,
        status: TransactionStatus.QUEUED,
        amount: new Prisma.Decimal(dto.amount),
        currency: dto.currency,
        fromAccount: dto.fromAccount,
        toAccount: dto.toAccount,
        metadata: (dto.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });

    try {
      await this.transactionQueue.add(PROCESS_TRANSACTION_JOB, {
        transactionId,
        ...dto,
      });
    } catch (error) {
      this.logger.error(`Failed to enqueue transaction ${transactionId}: ${error}`);
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.FAILED },
      });
      throw error;
    }

    return {
      id: transaction.id,
      status: transaction.status,
    };
  }

  async findById(id: string) {
    const transaction = await this.prisma.transaction.findUnique({ where: { id } });
    if (!transaction) {
      throw new NotFoundException(`Transaction ${id} not found`);
    }
    return transaction;
  }

  async findAll(query: ListTransactionsQueryDto) {
    const { page, limit, status, type, account, startDate, endDate } = query;
    const where: Prisma.TransactionWhereInput = {};

    if (status) where.status = status;
    if (type) where.type = type;
    if (account) {
      where.OR = [{ fromAccount: account }, { toAccount: account }];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { data, total, page, limit };
  }
}
