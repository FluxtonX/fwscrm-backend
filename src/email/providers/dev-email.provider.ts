import { Injectable, Logger } from '@nestjs/common';
import {
  EmailProvider,
  SendInvitationEmailParams,
  EmailDeliveryResult,
} from '../interfaces/email-provider.interface';

@Injectable()
export class DevEmailProvider implements EmailProvider {
  private readonly logger = new Logger('DevelopmentMailPreview');

  async sendInvitation(
    params: SendInvitationEmailParams,
  ): Promise<EmailDeliveryResult> {
    const formattedExpiry = new Date(params.expiresAt).toUTCString();

    const banner = [
      '======================== [DEV EMAIL PREVIEW] ========================',
      `TO:             ${params.toEmail}`,
      `ORGANIZATION:   ${params.organizationName}`,
      `ROLE:           ${params.role}`,
      `INVITED BY:     ${params.inviterName}`,
      `EXPIRES AT:     ${formattedExpiry}`,
      '---------------------------------------------------------------------',
      'ACTIVATION URL (Copy & paste into browser):',
      params.activationUrl,
      '=====================================================================',
    ].join('\n');

    this.logger.log(`\n${banner}\n`);

    return {
      success: true,
      provider: 'development',
      messageId: `dev-preview-${Date.now()}`,
    };
  }
}
