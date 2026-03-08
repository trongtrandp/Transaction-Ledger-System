import { Test, TestingModule } from '@nestjs/testing';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

describe('NotificationController', () => {
  let controller: NotificationController;
  let service: { findById: jest.Mock; findAll: jest.Mock };

  beforeEach(async () => {
    const mockService = {
      findById: jest.fn(),
      findAll: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [{ provide: NotificationService, useValue: mockService }],
    }).compile();

    controller = module.get(NotificationController);
    service = mockService;
  });

  describe('findOne', () => {
    it('should delegate to service.findById with id', async () => {
      const notification = { id: 'uuid-1', channel: 'WEBHOOK', status: 'SENT' };
      service.findById.mockResolvedValue(notification);

      const result = await controller.findOne('uuid-1');

      expect(result).toEqual(notification);
      expect(service.findById).toHaveBeenCalledWith('uuid-1');
    });
  });

  describe('findAll', () => {
    it('should delegate to service.findAll with query', async () => {
      const query: ListNotificationsQueryDto = { page: 1, limit: 10 };
      const expected = { data: [], total: 0, page: 1, limit: 10 };
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query);

      expect(result).toEqual(expected);
      expect(service.findAll).toHaveBeenCalledWith(query);
    });
  });
});
