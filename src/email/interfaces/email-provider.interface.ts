export interface SendInvitationEmailParams {
  toEmail: string;
  organizationName: string;
  role: string;
  inviterName: string;
  activationUrl: string;
  expiresAt: Date;
}

export interface EmailDeliveryResult {
  success: boolean;
  provider: 'brevo' | 'development';
  messageId?: string;
  error?: string;
}

export interface EmailProvider {
  sendInvitation(params: SendInvitationEmailParams): Promise<EmailDeliveryResult>;
}
