import { Test, TestingModule } from '@nestjs/testing';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';

describe('TransactionController', () => {
  let controller: TransactionController;
  let service: { createTransaction: jest.Mock; findById: jest.Mock; findAll: jest.Mock };

  beforeEach(async () => {
    const mockService = {
      createTransaction: jest.fn(),
      findById: jest.fn(),
      findAll: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionController],
      providers: [
        { provide: TransactionService, useValue: mockService },
        { provide: IdempotencyService, useValue: {} },
      ],
    }).compile();

    controller = module.get(TransactionController);
    service = mockService;
  });

  describe('create', () => {
    it('should delegate to service.createTransaction with dto', async () => {
      const dto: CreateTransactionDto = {
        type: 'DEPOSIT' as never,
        amount: '250.00',
        currency: 'USD',
      };
      const expected = { id: 'uuid-1', status: 'QUEUED' };
      service.createTransaction.mockResolvedValue(expected);

      const result = await controller.create(dto);

      expect(result).toEqual(expected);
      expect(service.createTransaction).toHaveBeenCalledWith(dto);
    });
  });

  describe('findOne', () => {
    it('should delegate to service.findById with id', async () => {
      const tx = { id: 'uuid-1', type: 'DEPOSIT', status: 'COMPLETED' };
      service.findById.mockResolvedValue(tx);

      const result = await controller.findOne('uuid-1');

      expect(result).toEqual(tx);
      expect(service.findById).toHaveBeenCalledWith('uuid-1');
    });
  });

  describe('findAll', () => {
    it('should delegate to service.findAll with query', async () => {
      const query: ListTransactionsQueryDto = { page: 1, limit: 20 };
      const expected = { data: [], total: 0, page: 1, limit: 20 };
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query);

      expect(result).toEqual(expected);
      expect(service.findAll).toHaveBeenCalledWith(query);
    });
  });
});
