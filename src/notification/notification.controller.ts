import { Controller, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { NotificationService } from './notification.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get(':id')
  @SkipThrottle()
  @ApiResponse({ status: 200, description: 'Notification details with transaction' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.notificationService.findById(id);
  }

  @Get()
  @SkipThrottle()
  @ApiResponse({ status: 200, description: 'Paginated notification list' })
  findAll(@Query() query: ListNotificationsQueryDto) {
    return this.notificationService.findAll(query);
  }
}
