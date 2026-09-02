import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from './notification-channel.interface';
import { NotificationMessage } from '../notification.types';
import { MailService } from '../../mail/mail.service';
import { SettingsService } from '../../settings/settings.service';

@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly name = 'email';
  private readonly logger = new Logger(EmailChannel.name);

  constructor(
    private mail: MailService,
    private settings: SettingsService,
  ) {}

  // Always post-commit / best-effort: never throws into the caller.
  async deliver(message: NotificationMessage): Promise<void> {
    if (!message.email) return; // event not email-worthy or no address
    try {
      const { ccEmail } = await this.settings.getNotifications();
      await this.mail.send(
        message.email.to,
        message.email.subject,
        message.email.html,
        message.email.text,
        ccEmail || undefined, // BCC internal monitor if configured
      );
    } catch (e) {
      this.logger.error(
        `Email channel failed for ${message.type} to user ${message.userId}: ${String(e)}`,
      );
    }
  }
}
