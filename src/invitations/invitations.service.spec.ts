import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsService } from './invitations.service';
import { PrismaService } from '../database/prisma.service';
import { Role, InvitationStatus } from '@prisma/client';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';

describe('InvitationsService', () => {
  let service: InvitationsService;
  let prisma: any;

  const mockOrganizationId = 'org-uuid-123';
  const mockInviterId = 'user-uuid-admin';

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      invitation: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<InvitationsService>(InvitationsService);
  });

  describe('generateTokenPair', () => {
    it('should generate a 64-char hex raw token and corresponding SHA-256 hash', () => {
      const { rawToken, tokenHash } = service.generateTokenPair();

      expect(rawToken).toHaveLength(64);
      expect(tokenHash).toHaveLength(64);
      expect(rawToken).not.toEqual(tokenHash);

      // Verify SHA-256 calculation
      const computedHash = service.hashToken(rawToken);
      expect(computedHash).toBe(tokenHash);
    });
  });

  describe('createInvitation', () => {
    it('should successfully create an invitation with hashed token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitation.findFirst.mockResolvedValue(null);

      const mockCreated = {
        id: 'inv-uuid-1',
        organizationId: mockOrganizationId,
        email: 'manager@example.com',
        role: Role.MANAGER,
        tokenHash: 'hashed-value',
        status: InvitationStatus.INVITED,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        acceptedAt: null,
        revokedAt: null,
        invitedById: mockInviterId,
        createdAt: new Date(),
        invitedBy: {
          id: mockInviterId,
          firstName: 'Admin',
          lastName: 'User',
          email: 'admin@example.com',
        },
      };

      prisma.invitation.create.mockResolvedValue(mockCreated);

      const result = await service.createInvitation(
        mockOrganizationId,
        mockInviterId,
        {
          email: 'manager@example.com',
          role: Role.MANAGER,
        },
      );

      expect(result.rawToken).toHaveLength(64);
      expect(result.invitation.email).toBe('manager@example.com');
      expect(result.invitation.role).toBe(Role.MANAGER);
      expect(result.invitation.status).toBe(InvitationStatus.INVITED);
      expect(prisma.invitation.create).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'user.invited',
            organizationId: mockOrganizationId,
            actorId: mockInviterId,
          }),
        }),
      );
    });

    it('should throw ConflictException if user is already an active member', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-user-id',
        email: 'active@example.com',
        isActive: true,
      });

      await expect(
        service.createInvitation(mockOrganizationId, mockInviterId, {
          email: 'active@example.com',
          role: Role.OPERATOR,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if a pending active invitation already exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitation.findFirst.mockResolvedValue({
        id: 'existing-inv',
        status: InvitationStatus.INVITED,
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // still valid
      });

      await expect(
        service.createInvitation(mockOrganizationId, mockInviterId, {
          email: 'pending@example.com',
          role: Role.OPERATOR,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('resendInvitation', () => {
    it('should renew token and expiration on resend', async () => {
      const existingInv = {
        id: 'inv-uuid-1',
        organizationId: mockOrganizationId,
        email: 'operator@example.com',
        status: InvitationStatus.INVITED,
        expiresAt: new Date(),
      };

      prisma.invitation.findFirst.mockResolvedValue(existingInv);
      prisma.invitation.update.mockImplementation(({ data }: { data: any }) => ({
        ...existingInv,
        ...data,
        invitedBy: {
          id: mockInviterId,
          firstName: 'Admin',
          lastName: 'User',
          email: 'admin@example.com',
        },
      }));

      const result = await service.resendInvitation(
        mockOrganizationId,
        'inv-uuid-1',
        mockInviterId,
      );

      expect(result.rawToken).toHaveLength(64);
      expect(prisma.invitation.update).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'user.invitation_resent',
            organizationId: mockOrganizationId,
            actorId: mockInviterId,
          }),
        }),
      );
    });

    it('should throw BadRequestException if invitation is already accepted', async () => {
      prisma.invitation.findFirst.mockResolvedValue({
        id: 'inv-uuid-1',
        status: InvitationStatus.ACCEPTED,
      });

      await expect(
        service.resendInvitation(mockOrganizationId, 'inv-uuid-1', mockInviterId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('revokeInvitation', () => {
    it('should set status to REVOKED', async () => {
      prisma.invitation.findFirst.mockResolvedValue({
        id: 'inv-uuid-1',
        organizationId: mockOrganizationId,
        status: InvitationStatus.INVITED,
      });

      prisma.invitation.update.mockResolvedValue({
        id: 'inv-uuid-1',
        status: InvitationStatus.REVOKED,
        revokedAt: new Date(),
        invitedBy: null,
      });

      const result = await service.revokeInvitation(
        mockOrganizationId,
        'inv-uuid-1',
        mockInviterId,
      );

      expect(result.status).toBe(InvitationStatus.REVOKED);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'user.invitation_revoked',
            organizationId: mockOrganizationId,
            actorId: mockInviterId,
          }),
        }),
      );
    });
  });

  describe('validateToken', () => {
    it('should validate and return invitation info for a valid token', async () => {
      const rawToken = 'a'.repeat(64);
      const tokenHash = service.hashToken(rawToken);

      prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        email: 'user@example.com',
        role: Role.OPERATOR,
        status: InvitationStatus.INVITED,
        expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        organization: {
          id: 'org-1',
          name: 'Acme Corp',
          slug: 'acme-corp',
        },
      });

      const result = await service.validateToken(rawToken);

      expect(result.email).toBe('user@example.com');
      expect(result.organization.name).toBe('Acme Corp');
    });

    it('should throw BadRequestException if token is expired', async () => {
      const rawToken = 'b'.repeat(64);

      prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        status: InvitationStatus.INVITED,
        expiresAt: new Date(Date.now() - 1000), // expired
        organization: {},
      });

      await expect(service.validateToken(rawToken)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if token has been revoked', async () => {
      const rawToken = 'c'.repeat(64);

      prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        status: InvitationStatus.REVOKED,
        organization: {},
      });

      await expect(service.validateToken(rawToken)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if token does not exist', async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);

      await expect(service.validateToken('nonexistent-token')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('acceptInvitation', () => {
    const rawToken = 'd'.repeat(64);
    const validDto = {
      token: rawToken,
      password: 'StrongPassword123!',
      firstName: 'Jane',
      lastName: 'Doe',
    };

    it('should atomically create user, activate account, and mark invitation accepted', async () => {
      const mockInv = {
        id: 'inv-uuid-1',
        organizationId: mockOrganizationId,
        email: 'jane@example.com',
        role: Role.MANAGER,
        status: InvitationStatus.INVITED,
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        organization: {
          id: mockOrganizationId,
          name: 'Acme Corp',
          slug: 'acme-corp',
        },
      };

      prisma.invitation.findUnique.mockResolvedValue(mockInv);
      prisma.user.findUnique.mockResolvedValue(null); // not existing yet

      const mockCreatedUser = {
        id: 'new-user-1',
        organizationId: mockOrganizationId,
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        role: Role.MANAGER,
        isActive: true,
      };

      prisma.$transaction = jest.fn().mockImplementation(async (callback) => {
        const tx = {
          user: { create: jest.fn().mockResolvedValue(mockCreatedUser) },
          invitation: { update: jest.fn().mockResolvedValue({}) },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        return callback(tx);
      });

      const result = await service.acceptInvitation(validDto);

      expect(result.user.email).toBe('jane@example.com');
      expect(result.user.role).toBe(Role.MANAGER);
      expect(result.organization.name).toBe('Acme Corp');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException if invitation is already accepted', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv-uuid-1',
        status: InvitationStatus.ACCEPTED,
        expiresAt: new Date(Date.now() + 5000),
      });

      await expect(service.acceptInvitation(validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ConflictException if user is already an active member', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv-uuid-1',
        organizationId: mockOrganizationId,
        email: 'active@example.com',
        status: InvitationStatus.INVITED,
        expiresAt: new Date(Date.now() + 5000),
      });

      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-id',
        email: 'active@example.com',
        isActive: true,
      });

      await expect(service.acceptInvitation(validDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
