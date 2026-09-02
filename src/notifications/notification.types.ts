import { NotificationType } from '@prisma/client';

// A resolved, channel-ready message for a single recipient.
export interface NotificationMessage {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // Email is best-effort; if the recipient has no email or the event
  // isn't email-worthy, email is skipped. In-app always writes.
  email?: {
    to: string;
    subject: string;
    html: string;
    text: string;
  };
}
