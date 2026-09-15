import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevEmailProvider } from './providers/dev-email.provider';
import { BrevoEmailProvider } from './providers/brevo-email.provider';
import {
  SendInvitationEmailParams,
  EmailDeliveryResult,
} from './interfaces/email-provider.interface';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly devProvider: DevEmailProvider,
    private readonly brevoProvider: BrevoEmailProvider,
  ) {}

  /**
   * Dispatches an invitation email using the configured email provider.
   * Uses Brevo if configured, falling back smoothly to Dev provider in local/dev environments.
   */
  async sendInvitationEmail(
    params: SendInvitationEmailParams,
  ): Promise<EmailDeliveryResult> {
    const brevoApiKey = this.configService.get<string>('BREVO_API_KEY');

    if (brevoApiKey && brevoApiKey.trim().length > 0) {
      this.logger.log(
        `Attempting transactional email delivery via Brevo to "${params.toEmail}"...`,
      );
      const result = await this.brevoProvider.sendInvitation(params);

      if (result.success) {
        return result;
      }

      this.logger.warn(
        `Brevo delivery failed (${result.error}). Falling back to development preview.`,
      );
    }

    // Fallback or default dev mail preview
    return this.devProvider.sendInvitation(params);
  }
}
