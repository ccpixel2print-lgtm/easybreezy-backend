import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationChannel } from './notification-channel.interface';
import { NotificationMessage } from '../notification.types';

@Injectable()
export class InAppChannel implements NotificationChannel {
  readonly name = 'in-app';

  constructor(private prisma: PrismaService) {}

  async deliver(
    message: NotificationMessage,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma; // enlist in caller's transaction if given
    await db.notification.create({
      data: {
        userId: message.userId,
        type: message.type,
        title: message.title,
        body: message.body,
        data: (message.data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
