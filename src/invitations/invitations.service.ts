import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { Role, InvitationStatus, Invitation } from '@prisma/client';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import {
  InvitationResponseItem,
  ValidatedInvitationInfo,
} from './dto/invitation-response.dto';

export interface GeneratedInvitationResult {
  invitation: InvitationResponseItem;
  rawToken: string;
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  private readonly defaultExpiryDays = 7;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cryptographically generates a secure random token and its SHA-256 hash.
   * The raw token is NEVER persisted in the database.
   */
  generateTokenPair(): { rawToken: string; tokenHash: string } {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    return { rawToken, tokenHash };
  }

  /**
   * Computes SHA-256 hash of a raw invitation token.
   */
  hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Creates a new invitation for an organization member.
   * Only Super Admin should have permission to call this.
   */
  async createInvitation(
    organizationId: string,
    invitedById: string,
    dto: CreateInvitationDto,
  ): Promise<GeneratedInvitationResult> {
    const email = dto.email.toLowerCase().trim();

    // 1. Check if user is already an active member of this organization
    const existingUser = await this.prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId,
          email,
        },
      },
    });

    if (existingUser && existingUser.isActive) {
      throw new ConflictException(
        `A user with email "${email}" is already an active member of this organization.`,
      );
    }

    // 2. Check for existing invitations for this email in this organization
    const existingInvitation = await this.prisma.invitation.findFirst({
      where: {
        organizationId,
        email,
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();

    if (existingInvitation) {
      // If already accepted, and user is active, conflict
      if (
        existingInvitation.status === InvitationStatus.ACCEPTED &&
        existingUser?.isActive
      ) {
        throw new ConflictException(
          `User "${email}" has already accepted an invitation and is an active member.`,
        );
      }

      // If pending and still within expiration window
      if (
        existingInvitation.status === InvitationStatus.INVITED &&
        existingInvitation.expiresAt > now
      ) {
        throw new ConflictException(
          `A pending invitation for "${email}" already exists. Please use the resend option if needed.`,
        );
      }
    }

    // 3. Generate secure cryptographic token pair
    const { rawToken, tokenHash } = this.generateTokenPair();
    const expiresAt = new Date(
      now.getTime() + this.defaultExpiryDays * 24 * 60 * 60 * 1000,
    );

    // 4. Persist invitation record with hashed token
    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId,
        email,
        role: dto.role,
        tokenHash,
        status: InvitationStatus.INVITED,
        expiresAt,
        invitedById,
      },
      include: {
        organization: {
          select: {
            name: true,
          },
        },
        invitedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // 5. Audit log
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId: invitedById,
        action: 'user.invited',
        targetType: 'invitation',
        targetId: invitation.id,
        metadata: {
          email,
          role: dto.role,
        },
      },
    });

    this.logger.log(
      `Invitation created for "${email}" (Role: ${dto.role}) in org "${organizationId}" by user "${invitedById}"`,
    );

    return {
      invitation: this.formatInvitation(invitation),
      rawToken,
    };
  }

  /**
   * Lists all invitations for an organization, with automatic expiration checking.
   */
  async listByOrganization(
    organizationId: string,
  ): Promise<InvitationResponseItem[]> {
    // Proactively expire any outdated INVITED invitations
    const now = new Date();
    await this.prisma.invitation.updateMany({
      where: {
        organizationId,
        status: InvitationStatus.INVITED,
        expiresAt: { lt: now },
      },
      data: {
        status: InvitationStatus.EXPIRED,
      },
    });

    const invitations = await this.prisma.invitation.findMany({
      where: { organizationId },
      include: {
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

    return invitations.map((inv) => this.formatInvitation(inv));
  }

  /**
   * Resends an existing invitation: generates a brand new secure token,
   * extends expiration by 7 days, and resets status to INVITED.
   */
  async resendInvitation(
    organizationId: string,
    invitationId: string,
    invitedById: string,
  ): Promise<GeneratedInvitationResult> {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, organizationId },
      include: {
        invitedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException(
        `Invitation with ID "${invitationId}" not found`,
      );
    }

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException(
        'Cannot resend an invitation that has already been accepted',
      );
    }

    if (invitation.status === InvitationStatus.REVOKED) {
      throw new BadRequestException(
        'Cannot resend a revoked invitation. Please issue a new invitation',
      );
    }

    const { rawToken, tokenHash } = this.generateTokenPair();
    const expiresAt = new Date(
      Date.now() + this.defaultExpiryDays * 24 * 60 * 60 * 1000,
    );

    const updated = await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        tokenHash,
        expiresAt,
        status: InvitationStatus.INVITED,
        invitedById,
        updatedAt: new Date(),
      },
      include: {
        organization: {
          select: {
            name: true,
          },
        },
        invitedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId: invitedById,
        action: 'user.invitation_resent',
        targetType: 'invitation',
        targetId: updated.id,
        metadata: {
          email: updated.email,
          role: updated.role,
        },
      },
    });

    this.logger.log(
      `Invitation ${invitationId} for "${updated.email}" resent by user "${invitedById}"`,
    );

    return {
      invitation: this.formatInvitation(updated),
      rawToken,
    };
  }

  /**
   * Revokes an active invitation.
   */
  async revokeInvitation(
    organizationId: string,
    invitationId: string,
    actorId?: string,
  ): Promise<InvitationResponseItem> {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, organizationId },
    });

    if (!invitation) {
      throw new NotFoundException(
        `Invitation with ID "${invitationId}" not found`,
      );
    }

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException(
        'Cannot revoke an invitation that has already been accepted',
      );
    }

    if (invitation.status === InvitationStatus.REVOKED) {
      throw new BadRequestException('This invitation is already revoked');
    }

    const updated = await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        status: InvitationStatus.REVOKED,
        revokedAt: new Date(),
      },
      include: {
        invitedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId: actorId || null,
        action: 'user.invitation_revoked',
        targetType: 'invitation',
        targetId: updated.id,
        metadata: {
          email: updated.email,
          role: updated.role,
        },
      },
    });

    this.logger.log(
      `Invitation ${invitationId} for "${updated.email}" revoked in org "${organizationId}"`,
    );

    return this.formatInvitation(updated);
  }

  /**
   * Validates an invitation raw token securely against the stored SHA-256 hash.
   * Public-facing (for users opening the invitation link in browser).
   */
  async validateToken(rawToken: string): Promise<ValidatedInvitationInfo> {
    if (
      !rawToken ||
      typeof rawToken !== 'string' ||
      rawToken.trim().length === 0
    ) {
      throw new BadRequestException('Invitation token is required');
    }

    const tokenHash = this.hashToken(rawToken.trim());

    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invalid or unrecognized invitation link');
    }

    if (invitation.status === InvitationStatus.REVOKED) {
      throw new BadRequestException(
        'This invitation has been revoked by an administrator',
      );
    }

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException(
        'This invitation has already been accepted. Please log in with your credentials.',
      );
    }

    const now = new Date();
    if (
      invitation.status === InvitationStatus.EXPIRED ||
      invitation.expiresAt < now
    ) {
      // Mark expired in DB if not already
      if (invitation.status !== InvitationStatus.EXPIRED) {
        await this.prisma.invitation.update({
          where: { id: invitation.id },
          data: { status: InvitationStatus.EXPIRED },
        });
      }
      throw new BadRequestException(
        'This invitation link has expired. Please request a new invitation from your administrator.',
      );
    }

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      organization: invitation.organization,
    };
  }

  /**
   * Accepts an invitation atomically:
   * 1. Validates the raw token hash and status.
   * 2. Transactionally creates or activates the user account with hashed password.
   * 3. Marks the invitation ACCEPTED.
   * 4. Creates an audit log entry.
   */
  async acceptInvitation(dto: AcceptInvitationDto) {
    if (
      !dto.token ||
      typeof dto.token !== 'string' ||
      dto.token.trim().length === 0
    ) {
      throw new BadRequestException('Invitation token is required');
    }

    const tokenHash = this.hashToken(dto.token.trim());

    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      include: {
        organization: true,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invalid or unrecognized invitation link');
    }

    if (invitation.status === InvitationStatus.REVOKED) {
      throw new BadRequestException(
        'This invitation has been revoked by an administrator',
      );
    }

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new BadRequestException(
        'This invitation has already been accepted. Please log in with your credentials.',
      );
    }

    const now = new Date();
    if (
      invitation.status === InvitationStatus.EXPIRED ||
      invitation.expiresAt < now
    ) {
      throw new BadRequestException('This invitation link has expired');
    }

    // Check existing user in organization
    const existingUser = await this.prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId: invitation.organizationId,
          email: invitation.email.toLowerCase(),
        },
      },
    });

    if (existingUser && existingUser.isActive) {
      throw new ConflictException(
        'An active account with this email address already exists',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Atomic transaction: create/activate user + accept invitation + audit log
    const { user, organization } = await this.prisma.$transaction(
      async (tx) => {
        let activeUser;

        if (existingUser) {
          activeUser = await tx.user.update({
            where: { id: existingUser.id },
            data: {
              passwordHash,
              firstName: dto.firstName.trim(),
              lastName: dto.lastName.trim(),
              role: invitation.role,
              isActive: true,
              updatedAt: new Date(),
            },
          });
        } else {
          activeUser = await tx.user.create({
            data: {
              organizationId: invitation.organizationId,
              email: invitation.email.toLowerCase(),
              passwordHash,
              firstName: dto.firstName.trim(),
              lastName: dto.lastName.trim(),
              role: invitation.role,
              isActive: true,
            },
          });
        }

        // Mark invitation accepted
        await tx.invitation.update({
          where: { id: invitation.id },
          data: {
            status: InvitationStatus.ACCEPTED,
            acceptedAt: new Date(),
          },
        });

        // Log audit event
        await tx.auditLog.create({
          data: {
            organizationId: invitation.organizationId,
            actorId: activeUser.id,
            action: 'user.invitation_accepted',
            targetType: 'user',
            targetId: activeUser.id,
            metadata: {
              email: invitation.email,
              role: invitation.role,
            },
          },
        });

        return { user: activeUser, organization: invitation.organization };
      },
    );

    this.logger.log(
      `Invitation accepted and account activated for "${user.email}" (${user.role}) in org "${organization.name}"`,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
    };
  }

  /**
   * Helper to format Prisma model to clean public-safe DTO.
   */
  private formatInvitation(inv: any): InvitationResponseItem {
    return {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      status: inv.status,
      expiresAt: inv.expiresAt,
      acceptedAt: inv.acceptedAt,
      revokedAt: inv.revokedAt,
      createdAt: inv.createdAt,
      organizationName: inv.organization?.name,
      invitedBy: inv.invitedBy || {
        id: inv.invitedById,
        firstName: 'System',
        lastName: 'Admin',
        email: '',
      },
    };
  }
}
