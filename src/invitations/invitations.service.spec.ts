import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsService } from './invitations.service';
import { PrismaService } from '../database/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, AccessType, InvitationStatus } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';

describe('InvitationsService', () => {
  let service: InvitationsService;
  let prisma: any;
  let emailService: any;
  let jwtService: any;

  const mockOrgId = 'org-123';
  const mockActorId = 'actor-superadmin-1';
  const mockInvitationId = 'inv-uuid-1';

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      organization: {
        findUnique: jest.fn(),
      },
      invitation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };

    emailService = {
      sendInvitationEmail: jest.fn().mockResolvedValue({
        success: true,
        provider: 'brevo',
        messageId: 'msg-brevo-123',
      }),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'FRONTEND_URL') return 'http://localhost:3000';
              return null;
            }),
          },
        },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
  });

  describe('createInvitation', () => {
    it('should create an invitation and send Brevo email successfully', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // existing user check
        .mockResolvedValueOnce({
          id: mockActorId,
          firstName: 'Alice',
          lastName: 'Admin',
        }); // inviter check

      prisma.organization.findUnique.mockResolvedValueOnce({
        id: mockOrgId,
        name: 'Acme Corp',
      });

      prisma.invitation.create.mockResolvedValueOnce({
        id: mockInvitationId,
        organizationId: mockOrgId,
        email: 'operator@acme.com',
        role: Role.OPERATOR,
        status: InvitationStatus.INVITED,
        accessType: AccessType.PERMANENT,
        allowedIp: null,
        accessExpiresAt: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      });

      const result = await service.createInvitation(mockOrgId, mockActorId, {
        email: 'operator@acme.com',
        role: Role.OPERATOR,
      });

      expect(result.invitation.email).toBe('operator@acme.com');
      expect(result.rawToken).toHaveLength(64); // 32 bytes hex
      expect(result.activationUrl).toContain('/accept-invitation?token=');
      expect(emailService.sendInvitationEmail).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'invitation.created',
            targetType: 'invitation',
          }),
        }),
      );
    });

    it('should accept valid CIDR subnets as allowedIp', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: mockActorId,
          firstName: 'Alice',
          lastName: 'Admin',
        });
      prisma.organization.findUnique.mockResolvedValueOnce({
        id: mockOrgId,
        name: 'Acme Corp',
      });

      prisma.invitation.create.mockResolvedValueOnce({
        id: mockInvitationId,
        organizationId: mockOrgId,
        email: 'manager@acme.com',
        role: Role.MANAGER,
        status: InvitationStatus.INVITED,
        accessType: AccessType.PERMANENT,
        allowedIp: '203.0.113.0/24',
        accessExpiresAt: null,
        expiresAt: new Date(),
        createdAt: new Date(),
      });

      const result = await service.createInvitation(mockOrgId, mockActorId, {
        email: 'manager@acme.com',
        role: Role.MANAGER,
        allowedIp: '203.0.113.0/24',
      });

      expect(result.invitation.allowedIp).toBe('203.0.113.0/24');
    });

    it('should reject invalid allowed IP or CIDR', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.createInvitation(mockOrgId, mockActorId, {
          email: 'test@acme.com',
          role: Role.OPERATOR,
          allowedIp: '999.999.999.999',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when user already exists in organization', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing-u1' });

      await expect(
        service.createInvitation(mockOrgId, mockActorId, {
          email: 'existing@acme.com',
          role: Role.OPERATOR,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('resendInvitation', () => {
    it('should update token and resend email for pending invitation', async () => {
      prisma.invitation.findFirst.mockResolvedValueOnce({
        id: mockInvitationId,
        organizationId: mockOrgId,
        email: 'pending@acme.com',
        role: Role.OPERATOR,
        status: InvitationStatus.INVITED,
        organization: { name: 'Acme Corp' },
      });

      prisma.user.findUnique.mockResolvedValueOnce({
        id: mockActorId,
        firstName: 'Alice',
        lastName: 'Admin',
      });

      prisma.invitation.update.mockResolvedValueOnce({
        id: mockInvitationId,
        email: 'pending@acme.com',
        role: Role.OPERATOR,
        status: InvitationStatus.INVITED,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      });

      const result = await service.resendInvitation(
        mockOrgId,
        mockInvitationId,
        mockActorId,
      );

      expect(result.rawToken).toBeDefined();
      expect(emailService.sendInvitationEmail).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'invitation.resent' }),
        }),
      );
    });

    it('should reject resending an already accepted invitation', async () => {
      prisma.invitation.findFirst.mockResolvedValueOnce({
        id: mockInvitationId,
        organizationId: mockOrgId,
        status: InvitationStatus.ACCEPTED,
      });

      await expect(
        service.resendInvitation(mockOrgId, mockInvitationId, mockActorId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('revokeInvitation', () => {
    it('should mark invitation as REVOKED', async () => {
      prisma.invitation.findFirst.mockResolvedValueOnce({
        id: mockInvitationId,
        organizationId: mockOrgId,
        status: InvitationStatus.INVITED,
      });

      prisma.invitation.update.mockResolvedValueOnce({
        id: mockInvitationId,
        status: InvitationStatus.REVOKED,
      });

      const result = await service.revokeInvitation(
        mockOrgId,
        mockInvitationId,
        mockActorId,
      );

      expect(result.success).toBe(true);
      expect(prisma.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: InvitationStatus.REVOKED }),
        }),
      );
    });
  });

  describe('validateToken', () => {
    it('should return safe invitation preview for valid token', async () => {
      const rawToken = 'abc123token';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      prisma.invitation.findUnique.mockResolvedValueOnce({
        id: mockInvitationId,
        email: 'invitee@acme.com',
        role: Role.OPERATOR,
        status: InvitationStatus.INVITED,
        expiresAt: new Date(Date.now() + 100000),
        organization: { id: mockOrgId, name: 'Acme Corp', slug: 'acme' },
        invitedBy: { firstName: 'Alice', lastName: 'Admin' },
      });

      const result = await service.validateToken(rawToken);

      expect(result.valid).toBe(true);
      expect(result.email).toBe('invitee@acme.com');
      expect(result.organizationName).toBe('Acme Corp');
    });

    it('should reject expired token', async () => {
      const rawToken = 'expiredToken';
      prisma.invitation.findUnique.mockResolvedValueOnce({
        id: mockInvitationId,
        email: 'expired@acme.com',
        status: InvitationStatus.INVITED,
        expiresAt: new Date(Date.now() - 1000), // expired in past
      });

      prisma.invitation.update.mockResolvedValueOnce({});

      await expect(service.validateToken(rawToken)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('acceptInvitation', () => {
    it('should activate user, mark invitation ACCEPTED, and return session token', async () => {
      const rawToken = 'validRawToken12345';
      prisma.invitation.findUnique.mockResolvedValueOnce({
        id: mockInvitationId,
        organizationId: mockOrgId,
        email: 'newuser@acme.com',
        role: Role.OPERATOR,
        status: InvitationStatus.INVITED,
        accessType: AccessType.PERMANENT,
        allowedIp: null,
        accessExpiresAt: null,
        expiresAt: new Date(Date.now() + 100000),
        organization: { id: mockOrgId, name: 'Acme Corp', slug: 'acme' },
      });

      prisma.user.findUnique.mockResolvedValueOnce(null); // not existing

      prisma.user.create.mockResolvedValueOnce({
        id: 'new-user-uuid',
        organizationId: mockOrgId,
        email: 'newuser@acme.com',
        firstName: 'Bob',
        lastName: 'Builder',
        role: Role.OPERATOR,
        isActive: true,
      });

      prisma.invitation.update.mockResolvedValueOnce({});

      const result = await service.acceptInvitation({
        token: rawToken,
        firstName: 'Bob',
        lastName: 'Builder',
        password: 'password123',
        confirmPassword: 'password123',
      });

      expect(result.user.email).toBe('newuser@acme.com');
      expect(result.token).toBe('mock-jwt-token');
      expect(prisma.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: InvitationStatus.ACCEPTED }),
        }),
      );
    });

    it('should reject password mismatch', async () => {
      await expect(
        service.acceptInvitation({
          token: 'token',
          firstName: 'Bob',
          lastName: 'Builder',
          password: 'password123',
          confirmPassword: 'differentPassword',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
