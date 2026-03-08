import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { Prisma } from '../generated/prisma/client';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
      include: { transaction: true },
    });
    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    return notification;
  }

  async findAll(query: ListNotificationsQueryDto) {
    const { page, limit, status, channel, transactionId } = query;
    const where: Prisma.NotificationWhereInput = {};

    if (status) where.status = status;
    if (channel) where.channel = channel;
    if (transactionId) where.transactionId = transactionId;

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, total, page, limit };
  }
}
