import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { EmailService } from '../email/email.service';
import { Role, AccessType, InvitationStatus, User } from '@prisma/client';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { isValidAllowedIpList } from '../common/utils/ip-validator.util';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  private readonly saltRounds = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Hashes a raw invitation token with SHA-256 for secure database storage.
   */
  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Constructs the absolute frontend activation URL.
   */
  private buildActivationUrl(rawToken: string): string {
    const rawFrontend =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const baseUrl = rawFrontend
      .split(',')[0]
      .trim()
      .replace(/\/+$/, '');
    return `${baseUrl}/accept-invitation?token=${rawToken}`;
  }

  /**
   * Creates a secure invitation, generates token, sends Brevo email, and provides copyable URL.
   */
  async createInvitation(
    organizationId: string,
    actorId: string,
    dto: CreateInvitationDto,
  ) {
    if (dto.role !== Role.MANAGER && dto.role !== Role.OPERATOR) {
      throw new BadRequestException(
        'Only MANAGER and OPERATOR roles can be invited to team workspaces',
      );
    }

    const normalizedEmail = dto.email.toLowerCase().trim();

    // 1. Check if user already exists in this organization
    const existingUser = await this.prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId,
          email: normalizedEmail,
        },
      },
    });

    if (existingUser) {
      throw new ConflictException(
        `A member with email "${normalizedEmail}" is already registered in this workspace`,
      );
    }

    // 2. Validate IP / CIDR format if provided
    if (dto.allowedIp) {
      if (!isValidAllowedIpList(dto.allowedIp)) {
        throw new BadRequestException(
          'Allowed IP must be a valid IPv4/IPv6 address, CIDR block (e.g. 203.0.113.0/24), or comma-separated list',
        );
      }
    }

    // 3. Validate expiration for temporary access
    let accessExpiresDate: Date | null = null;
    if (dto.accessType === AccessType.TEMPORARY) {
      if (!dto.accessExpiresAt) {
        throw new BadRequestException(
          'Expiration date is required when temporary access is selected',
        );
      }
      accessExpiresDate = new Date(dto.accessExpiresAt);
      if (isNaN(accessExpiresDate.getTime()) || accessExpiresDate <= new Date()) {
        throw new BadRequestException(
          'Access expiration date must be a valid timestamp in the future',
        );
      }
    }

    // 4. Fetch organization and inviter metadata for the transactional email
    const [organization, inviter] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.user.findUnique({ where: { id: actorId } }),
    ]);

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    // 5. Generate cryptographically secure token & SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // 6. Atomically invalidate previous pending invitations and store the new invitation
    const invitation = await this.prisma.$transaction(async (tx) => {
      // Clean up previous pending invitations for this email in this org
      await tx.invitation.deleteMany({
        where: {
          organizationId,
          email: normalizedEmail,
          status: InvitationStatus.INVITED,
        },
      });

      return tx.invitation.create({
        data: {
          organizationId,
          email: normalizedEmail,
          role: dto.role,
          tokenHash,
          status: InvitationStatus.INVITED,
          accessType: dto.accessType || AccessType.PERMANENT,
          allowedIp: dto.allowedIp?.trim() || null,
          accessExpiresAt: accessExpiresDate,
          expiresAt,
          invitedById: actorId,
        },
      });
    });

    const activationUrl = this.buildActivationUrl(rawToken);
    const inviterName = inviter
      ? `${inviter.firstName} ${inviter.lastName}`.trim()
      : 'Workspace Administrator';

    // 7. Dispatch invitation email via Brevo
    const emailDelivery = await this.emailService.sendInvitationEmail({
      toEmail: normalizedEmail,
      organizationName: organization.name,
      role: dto.role,
      inviterName,
      activationUrl,
      expiresAt,
    });

    // 8. Security audit logging
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'invitation.created',
        targetType: 'invitation',
        targetId: invitation.id,
        metadata: {
          email: normalizedEmail,
          role: dto.role,
          accessType: invitation.accessType,
          allowedIp: invitation.allowedIp,
          emailDeliverySuccess: emailDelivery.success,
        },
      },
    });

    this.logger.log(
      `Invitation created for "${normalizedEmail}" (${dto.role}) in org "${organization.name}". Brevo sent: ${emailDelivery.success}`,
    );

    return {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        accessType: invitation.accessType,
        allowedIp: invitation.allowedIp,
        accessExpiresAt: invitation.accessExpiresAt,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      },
      rawToken,
      activationUrl,
      emailDelivery,
    };
  }

  /**
   * Resends an invitation with a fresh token and expiration extension.
   */
  async resendInvitation(
    organizationId: string,
    invitationId: string,
    actorId: string,
  ) {
    const existing = await this.prisma.invitation.findFirst({
      where: { id: invitationId, organizationId },
      include: { organization: true },
    });

    if (!existing) {
      throw new NotFoundException('Invitation not found in this organization');
    }

    if (existing.status === InvitationStatus.ACCEPTED) {
      throw new ConflictException(
        'This invitation has already been accepted and the account is active',
      );
    }

    const inviter = await this.prisma.user.findUnique({ where: { id: actorId } });
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const updated = await this.prisma.invitation.update({
      where: { id: invitationId },
      data: {
        tokenHash,
        status: InvitationStatus.INVITED,
        expiresAt,
      },
    });

    const activationUrl = this.buildActivationUrl(rawToken);
    const inviterName = inviter
      ? `${inviter.firstName} ${inviter.lastName}`.trim()
      : 'Workspace Administrator';

    const emailDelivery = await this.emailService.sendInvitationEmail({
      toEmail: updated.email,
      organizationName: existing.organization.name,
      role: updated.role,
      inviterName,
      activationUrl,
      expiresAt,
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'invitation.resent',
        targetType: 'invitation',
        targetId: updated.id,
        metadata: {
          email: updated.email,
          emailDeliverySuccess: emailDelivery.success,
        },
      },
    });

    return {
      invitation: {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        status: updated.status,
        expiresAt: updated.expiresAt,
        updatedAt: updated.updatedAt,
      },
      rawToken,
      activationUrl,
      emailDelivery,
    };
  }

  /**
   * Revokes a pending invitation immediately.
   */
  async revokeInvitation(
    organizationId: string,
    invitationId: string,
    actorId: string,
  ) {
    const existing = await this.prisma.invitation.findFirst({
      where: { id: invitationId, organizationId },
    });

    if (!existing) {
      throw new NotFoundException('Invitation not found in this organization');
    }

    if (existing.status === InvitationStatus.ACCEPTED) {
      throw new ConflictException('Accepted invitations cannot be revoked');
    }

    const updated = await this.prisma.invitation.update({
      where: { id: invitationId },
      data: {
        status: InvitationStatus.REVOKED,
        revokedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'invitation.revoked',
        targetType: 'invitation',
        targetId: updated.id,
        metadata: { email: updated.email },
      },
    });

    return { success: true, message: 'Invitation has been revoked successfully' };
  }

  /**
   * Lists all pending invitations for the organization.
   */
  async listPendingInvitations(organizationId: string) {
    return this.prisma.invitation.findMany({
      where: {
        organizationId,
        status: InvitationStatus.INVITED,
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        accessType: true,
        allowedIp: true,
        accessExpiresAt: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Public validation of an invitation token (safe preview).
   */
  async validateToken(rawToken: string) {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new BadRequestException('Invitation token is required');
    }

    const tokenHash = this.hashToken(rawToken.trim());
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        invitedBy: { select: { firstName: true, lastName: true } },
      },
    });

    if (!invitation || invitation.status === InvitationStatus.REVOKED) {
      throw new NotFoundException(
        'This invitation is invalid, has expired, or was revoked by an administrator',
      );
    }

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new ConflictException(
        'This invitation has already been accepted. Please sign in with your credentials.',
      );
    }

    if (new Date() >= invitation.expiresAt) {
      // Mark as expired if encountered
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new BadRequestException(
        'This invitation link has expired. Please contact your administrator for a new invitation.',
      );
    }

    return {
      valid: true,
      email: invitation.email,
      organizationName: invitation.organization.name,
      role: invitation.role,
      inviterName: invitation.invitedBy
        ? `${invitation.invitedBy.firstName} ${invitation.invitedBy.lastName}`.trim()
        : 'Workspace Administrator',
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Accepts invitation, creates user account, marks invitation ACCEPTED, and returns session.
   */
  async acceptInvitation(dto: AcceptInvitationDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    if (dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    const tokenHash = this.hashToken(dto.token.trim());

    // Execute atomic acceptance & user creation in transaction
    const { user, organization } = await this.prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash },
        include: { organization: true },
      });

      if (!invitation || invitation.status !== InvitationStatus.INVITED) {
        throw new BadRequestException(
          'This invitation is invalid, has already been used, or was revoked',
        );
      }

      if (new Date() >= invitation.expiresAt) {
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: InvitationStatus.EXPIRED },
        });
        throw new BadRequestException(
          'This invitation has expired. Please request a new invitation from your administrator.',
        );
      }

      // Check if user already exists
      const existingUser = await tx.user.findUnique({
        where: {
          organizationId_email: {
            organizationId: invitation.organizationId,
            email: invitation.email.toLowerCase(),
          },
        },
      });

      if (existingUser) {
        throw new ConflictException(
          'An account with this email address already exists in the workspace',
        );
      }

      const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

      // Create new user with access policy configured during invitation
      const newUser = await tx.user.create({
        data: {
          organizationId: invitation.organizationId,
          email: invitation.email.toLowerCase(),
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          role: invitation.role,
          isActive: true,
          accessType: invitation.accessType || AccessType.PERMANENT,
          allowedIp: invitation.allowedIp || null,
          accessExpiresAt: invitation.accessExpiresAt || null,
        },
      });

      // Mark invitation as accepted
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt: new Date(),
        },
      });

      // Create audit logs
      await tx.auditLog.create({
        data: {
          organizationId: invitation.organizationId,
          actorId: newUser.id,
          action: 'invitation.accepted',
          targetType: 'invitation',
          targetId: invitation.id,
          metadata: { email: newUser.email, role: newUser.role },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: invitation.organizationId,
          actorId: newUser.id,
          action: 'user.activated',
          targetType: 'user',
          targetId: newUser.id,
          metadata: { email: newUser.email, role: newUser.role },
        },
      });

      return { user: newUser, organization: invitation.organization };
    });

    // Generate JWT token for immediate login
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      organizationId: user.organizationId,
      role: user.role,
    };
    const token = this.jwtService.sign(payload);

    this.logger.log(
      `Invitation accepted: User "${user.email}" (${user.role}) activated in organization "${organization.name}"`,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        accessType: user.accessType,
        allowedIp: user.allowedIp,
        accessExpiresAt: user.accessExpiresAt,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      token,
    };
  }
}
