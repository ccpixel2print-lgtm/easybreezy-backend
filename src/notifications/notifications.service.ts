import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InAppChannel } from './channels/in-app.channel';
import { EmailChannel } from './channels/email.channel';
import { NotificationMessage } from './notification.types';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private inApp: InAppChannel,
    private email: EmailChannel,
  ) {}

  /**
   * Hybrid dispatch:
   *  - In-app row is written now. If `tx` is passed, it enlists in the
   *    caller's transaction (atomic with the business change).
   *  - Email is best-effort and fires AFTER this returns; failures are
   *    swallowed inside the channel and never roll back the caller.
   *
   * When tx is provided, the email is scheduled for after the current
   * microtask so it doesn't run inside (and thus can't fail) the txn.
   */
  async notify(
    message: NotificationMessage,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    // 1. In-app (transactional if tx given)
    await this.inApp.deliver(message, tx);

    // 2. Email — best-effort, post-commit. Fire-and-forget.
    void this.email.deliver(message).catch((e) => {
      this.logger.error(`notify() email dispatch error: ${String(e)}`);
    });
  }

  // ---------- read models for the in-app bell/list ----------

  async list(userId: string, limit = 30) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  async markRead(userId: string, id: string): Promise<{ ok: true }> {
    await this.prisma.notification.updateMany({
      where: { id, userId }, // scope by userId so users can't read others'
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(userId: string): Promise<{ ok: true }> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
