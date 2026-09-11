import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { DevEmailProvider } from './providers/dev-email.provider';
import { BrevoEmailProvider } from './providers/brevo-email.provider';

describe('EmailService', () => {
  let service: EmailService;
  let configService: any;
  let devProvider: any;
  let brevoProvider: any;

  const mockParams = {
    toEmail: 'newuser@example.com',
    organizationName: 'Test Organization',
    role: 'MANAGER',
    inviterName: 'Admin Person',
    activationUrl: 'http://localhost:3000/accept-invitation?token=test-token',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    };

    devProvider = {
      sendInvitation: jest.fn().mockResolvedValue({
        success: true,
        provider: 'development',
        messageId: 'dev-preview-123',
      }),
    };

    brevoProvider = {
      sendInvitation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: configService },
        { provide: DevEmailProvider, useValue: devProvider },
        { provide: BrevoEmailProvider, useValue: brevoProvider },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  it('should use DevEmailProvider when BREVO_API_KEY is not configured', async () => {
    configService.get.mockReturnValue('');

    const result = await service.sendInvitationEmail(mockParams);

    expect(result.provider).toBe('development');
    expect(devProvider.sendInvitation).toHaveBeenCalledWith(mockParams);
    expect(brevoProvider.sendInvitation).not.toHaveBeenCalled();
  });

  it('should use BrevoEmailProvider when BREVO_API_KEY is configured and succeeds', async () => {
    configService.get.mockReturnValue('xkeysib-mock-api-key');
    brevoProvider.sendInvitation.mockResolvedValue({
      success: true,
      provider: 'brevo',
      messageId: 'brevo-msg-456',
    });

    const result = await service.sendInvitationEmail(mockParams);

    expect(result.provider).toBe('brevo');
    expect(result.messageId).toBe('brevo-msg-456');
    expect(brevoProvider.sendInvitation).toHaveBeenCalledWith(mockParams);
    expect(devProvider.sendInvitation).not.toHaveBeenCalled();
  });

  it('should fallback to DevEmailProvider when Brevo delivery fails', async () => {
    configService.get.mockReturnValue('xkeysib-mock-api-key');
    brevoProvider.sendInvitation.mockResolvedValue({
      success: false,
      provider: 'brevo',
      error: 'Brevo HTTP 401: Unauthorized',
    });

    const result = await service.sendInvitationEmail(mockParams);

    expect(result.provider).toBe('development');
    expect(brevoProvider.sendInvitation).toHaveBeenCalledWith(mockParams);
    expect(devProvider.sendInvitation).toHaveBeenCalledWith(mockParams);
  });
});
