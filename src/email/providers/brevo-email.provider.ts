import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailProvider,
  SendInvitationEmailParams,
  EmailDeliveryResult,
} from '../interfaces/email-provider.interface';

@Injectable()
export class BrevoEmailProvider implements EmailProvider {
  private readonly logger = new Logger(BrevoEmailProvider.name);
  private readonly brevoApiUrl = 'https://api.brevo.com/v3/smtp/email';

  constructor(private readonly configService: ConfigService) {}

  async sendInvitation(
    params: SendInvitationEmailParams,
  ): Promise<EmailDeliveryResult> {
    const apiKey = this.configService.get<string>('BREVO_API_KEY');

    if (!apiKey || apiKey.trim().length === 0) {
      this.logger.warn(
        'BREVO_API_KEY is not configured. Falling back to development mail delivery.',
      );
      return {
        success: false,
        provider: 'brevo',
        error: 'BREVO_API_KEY not configured',
      };
    }

    const senderEmail =
      this.configService.get<string>('BREVO_SENDER_EMAIL') ||
      this.configService.get<string>('EMAIL_FROM') ||
      'no-reply@fwscrm.com';
    const senderName =
      this.configService.get<string>('BREVO_SENDER_NAME') ||
      this.configService.get<string>('EMAIL_FROM_NAME') ||
      'FWS CRM';

    const subject = `You've been invited to join ${params.organizationName} on FWS CRM`;
    const formattedExpiry = new Date(params.expiresAt).toLocaleDateString(
      'en-US',
      {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      },
    );

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { background-color: #0A2428; padding: 32px; text-align: center; }
    .logo { color: #22D3DA; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .content { padding: 40px 32px; color: #334155; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 16px; }
    .body-text { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
    .card { background-color: #f1f5f9; border-radius: 8px; padding: 16px 20px; margin-bottom: 28px; border-left: 4px solid #0D9488; }
    .card-item { font-size: 13px; color: #334155; margin-bottom: 6px; }
    .card-item strong { color: #0f172a; }
    .btn-container { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background-color: #0D9488; color: #ffffff !important; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 8px; text-decoration: none; box-shadow: 0 2px 4px rgba(13, 148, 136, 0.2); }
    .footer { background-color: #f8fafc; padding: 24px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    .link-alt { word-break: break-all; font-size: 12px; color: #0D9488; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">FWS CRM</div>
    </div>
    <div class="content">
      <div class="title">Join Your Team Workspace</div>
      <p class="body-text">
        Hello,<br><br>
        <strong>${params.inviterName}</strong> has invited you to join <strong>${params.organizationName}</strong> on FWS CRM as an authorized team member.
      </p>

      <div class="card">
        <div class="card-item"><strong>Organization:</strong> ${params.organizationName}</div>
        <div class="card-item"><strong>Assigned Role:</strong> ${params.role}</div>
        <div class="card-item"><strong>Link Validity:</strong> Valid until ${formattedExpiry}</div>
      </div>

      <div class="btn-container">
        <a href="${params.activationUrl}" class="btn" target="_blank">Accept Invitation & Activate Account</a>
      </div>

      <p class="body-text" style="font-size: 12px; color: #64748b;">
        If the button above does not work, copy and paste this link into your browser:<br>
        <a href="${params.activationUrl}" class="link-alt">${params.activationUrl}</a>
      </p>
    </div>
    <div class="footer">
      This invitation was issued securely by FWS CRM. If you were not expecting this invitation, you can safely ignore this email.
    </div>
  </div>
</body>
</html>
`;

    const textContent = `
You've been invited to join ${params.organizationName} on FWS CRM

${params.inviterName} has invited you to collaborate on FWS CRM.
Role: ${params.role}
Expires: ${formattedExpiry}

To accept your invitation and activate your account, click the link below:
${params.activationUrl}

If you were not expecting this email, you may safely ignore it.
`;

    try {
      const response = await fetch(this.brevoApiUrl, {
        method: 'POST',
        headers: {
          'api-key': apiKey.trim(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: params.toEmail }],
          subject,
          htmlContent,
          textContent,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Brevo API responded with error (${response.status}): ${errorBody}`,
        );
        return {
          success: false,
          provider: 'brevo',
          error: `Brevo HTTP ${response.status}: ${errorBody}`,
        };
      }

      const responseData = (await response.json()) as { messageId?: string };
      this.logger.log(
        `Brevo invitation email sent successfully to "${params.toEmail}". MessageId: ${responseData.messageId}`,
      );

      return {
        success: true,
        provider: 'brevo',
        messageId: responseData.messageId,
      };
    } catch (err: any) {
      this.logger.error(`Failed to dispatch email via Brevo: ${err.message}`);
      return {
        success: false,
        provider: 'brevo',
        error: err.message,
      };
    }
  }
}
