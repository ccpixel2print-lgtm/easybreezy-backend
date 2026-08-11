import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string;
  private readonly enabled: boolean;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    // e.g. "Easy Breezy <noreply@easybreezy.in>"
    this.fromAddress =
      this.config.get<string>('MAIL_FROM') ?? 'Easy Breezy <onboarding@resend.dev>';

    this.enabled = !!apiKey;
    this.resend = apiKey ? new Resend(apiKey) : null;

    if (!this.enabled) {
      this.logger.warn(
        'RESEND_API_KEY not set — emails will be logged to console instead of sent.',
      );
    }
  }

  // ---- Send an OTP login code ----
  async sendOtp(toEmail: string, code: string, expiryMins: number) {
    const subject = 'Your Easy Breezy login code';
    const html = this.otpTemplate(code, expiryMins);
    const text = `Your Easy Breezy login code is ${code}. It expires in ${expiryMins} minutes. If you didn't request this, you can ignore this email.`;

    return this.send(toEmail, subject, html, text);
  }

  // ---- Generic send with graceful fallback ----
  private async send(to: string, subject: string, html: string, text: string) {
    if (!this.enabled || !this.resend) {
      // Fallback for local/dev: log instead of sending.
      this.logger.log(`\n[MAIL FALLBACK] To: ${to}\nSubject: ${subject}\n${text}\n`);
      return { sent: false, fallback: true };
    }

    const { data, error } = await this.resend.emails.send({
      from: this.fromAddress,
      to: [to],
      subject,
      html,
      text,
    });

    if (error) {
      // Log full error server-side; don't leak details to the caller.
      this.logger.error(`Resend send failed to ${to}: ${JSON.stringify(error)}`);
      return { sent: false, fallback: false, error: true };
    }

    this.logger.log(`Email sent to ${to} (id: ${data?.id})`);
    return { sent: true, id: data?.id };
  }

  private otpTemplate(code: string, expiryMins: number): string {
    return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937;">
      <h2 style="color:#0d9488;margin:0 0 16px;">Easy Breezy</h2>
      <p style="font-size:15px;line-height:1.5;">Use the code below to sign in. It's valid for <strong>${expiryMins} minutes</strong>.</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f0fdfa;color:#0f766e;text-align:center;padding:16px;border-radius:12px;margin:20px 0;">
        ${code}
      </div>
      <p style="font-size:13px;color:#6b7280;line-height:1.5;">If you didn't request this code, you can safely ignore this email — no changes will be made to your account.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="font-size:12px;color:#9ca3af;">Easy Breezy · Home services in Hyderabad</p>
    </div>`;
  }
}
