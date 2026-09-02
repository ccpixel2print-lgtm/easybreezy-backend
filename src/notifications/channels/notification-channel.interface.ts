import { Prisma } from '@prisma/client';
import { NotificationMessage } from '../notification.types';

export interface NotificationChannel {
  readonly name: string;
  // in-app enlists in tx when provided; email/whatsapp ignore tx (post-commit).
  deliver(
    message: NotificationMessage,
    tx?: Prisma.TransactionClient,
  ): Promise<void>;
}
