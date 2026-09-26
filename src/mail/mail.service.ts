import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Sends transactional email (currently: email verification). If MAIL_HOST/MAIL_USER/MAIL_PASS
 * are set in .env, it sends real SMTP mail via nodemailer. If they're not set (e.g. local dev),
 * it falls back to logging the message to the console so the flow still works end-to-end
 * without requiring real mail credentials.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private configured = false;

  onModuleInit() {
    const { MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS } = process.env;
    if (MAIL_HOST && MAIL_USER && MAIL_PASS) {
      this.transporter = nodemailer.createTransport({
        host: MAIL_HOST,
        port: Number(MAIL_PORT) || 587,
        secure: Number(MAIL_PORT) === 465,
        auth: { user: MAIL_USER, pass: MAIL_PASS },
      });
      this.configured = true;
      this.logger.log(`SMTP transport configured (${MAIL_HOST})`);
    } else {
      this.logger.warn(
        'MAIL_HOST/MAIL_USER/MAIL_PASS not set - emails will be logged to the console instead of sent. ' +
          'Set them in .env to send real mail.',
      );
    }
  }

  async sendVerificationEmail(to: string, token: string) {
    const verifyUrl = `${process.env.APP_PUBLIC_URL || 'http://localhost:3000'}/api/v1/auth/verify-email?token=${token}`;
    const subject = 'Verify your EchoGPT account';
    const text = `Welcome to EchoGPT! Verify your email by visiting: ${verifyUrl}\n\n(Token: ${token})`;
    const html = `<p>Welcome to EchoGPT!</p><p>Verify your email by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`;

    await this.send({ to, subject, text, html });
  }

  private async send(opts: { to: string; subject: string; text: string; html: string }) {
    if (!this.configured || !this.transporter) {
      this.logger.log(`[dev-mail] To: ${opts.to} | Subject: ${opts.subject}\n${opts.text}`);
      return { delivered: false, mode: 'console-fallback' as const };
    }

    try {
      await this.transporter.sendMail({
        from: process.env.MAIL_FROM || 'no-reply@echogpt.app',
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
      return { delivered: true, mode: 'smtp' as const };
    } catch (err) {
      // Never let a mail failure break registration - log and fall through.
      this.logger.error(`Failed to send email to ${opts.to}: ${(err as Error).message}`);
      return { delivered: false, mode: 'smtp-failed' as const };
    }
  }
}
