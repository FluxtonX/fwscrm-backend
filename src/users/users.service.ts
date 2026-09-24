import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { User, Role, AccessType } from '@prisma/client';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateUserIpDto } from './dto/update-user-ip.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { isValidIp, normalizeIp } from '../common/utils/ip-validator.util';

export interface CreateUserData {
  organizationId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role?: Role;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly saltRounds = 12;

  constructor(private readonly prisma: PrismaService) {}

  async createMember(
    organizationId: string,
    actorId: string,
    dto: CreateMemberDto,
  ): Promise<Omit<User, 'passwordHash'>> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    if (dto.role !== Role.MANAGER && dto.role !== Role.OPERATOR) {
      throw new BadRequestException(
        'Only MANAGER and OPERATOR roles can be assigned to new team members',
      );
    }

    const normalizedEmail = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId,
          email: normalizedEmail,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `A user with this email address already exists in this organization`,
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    const firstName =
      dto.firstName && dto.firstName.trim().length > 0
        ? dto.firstName.trim()
        : normalizedEmail.split('@')[0];
    const lastName =
      dto.lastName && dto.lastName.trim().length > 0
        ? dto.lastName.trim()
        : '';

    // Access Control Validation & Normalization
    let normalizedAllowedIp: string | null = null;
    if (dto.allowedIp && dto.allowedIp.trim().length > 0) {
      if (!isValidIp(dto.allowedIp)) {
        throw new BadRequestException('Allowed IP must be a valid IPv4 or IPv6 address');
      }
      normalizedAllowedIp = normalizeIp(dto.allowedIp);
    }

    let parsedExpiresAt: Date | null = null;
    const accessType = dto.accessType || (normalizedAllowedIp ? AccessType.PERMANENT : null);

    if (accessType === AccessType.TEMPORARY) {
      if (!dto.accessExpiresAt) {
        throw new BadRequestException('Expiration date is required for temporary access');
      }
      parsedExpiresAt = new Date(dto.accessExpiresAt);
      if (isNaN(parsedExpiresAt.getTime())) {
        throw new BadRequestException('Invalid expiration date format');
      }
      if (parsedExpiresAt <= new Date()) {
        throw new BadRequestException('Expiration date must be in the future');
      }
    }

    const user = await this.prisma.user.create({
      data: {
        organizationId,
        email: normalizedEmail,
        passwordHash,
        firstName,
        lastName,
        role: dto.role,
        isActive: true,
        accessType,
        allowedIp: normalizedAllowedIp,
        accessExpiresAt: parsedExpiresAt,
      },
      select: {
        id: true,
        organizationId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        accessType: true,
        allowedIp: true,
        accessExpiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'user.created',
        targetType: 'user',
        targetId: user.id,
        metadata: {
          email: user.email,
          role: user.role,
          accessType,
          allowedIp: normalizedAllowedIp,
          accessExpiresAt: parsedExpiresAt ? parsedExpiresAt.toISOString() : null,
        },
      },
    });

    this.logger.log(
      `Created team member "${user.email}" (${user.role}) [IP: ${normalizedAllowedIp || 'None'}, Access: ${accessType || 'Standard'}] in org "${organizationId}" by actor "${actorId}"`,
    );

    return user;
  }


  async create(data: CreateUserData): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId: data.organizationId,
          email: data.email.toLowerCase(),
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `User with email "${data.email}" already exists in this organization`,
      );
    }

    const user = await this.prisma.user.create({
      data: {
        organizationId: data.organizationId,
        email: data.email.toLowerCase(),
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role || Role.AGENT,
      },
    });

    this.logger.log(
      `Created user "${user.email}" (${user.role}) in org ${data.organizationId}`,
    );
    return user;
  }

  async findByEmail(
    organizationId: string,
    email: string,
  ): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId,
          email: email.toLowerCase(),
        },
      },
    });
  }

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return user;
  }

  async listByOrganization(
    organizationId: string,
    includeInactive = true,
  ): Promise<Omit<User, 'passwordHash'>[]> {
    const where: any = { organizationId };
    if (!includeInactive) {
      where.isActive = true;
    }

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        organizationId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        accessType: true,
        allowedIp: true,
        accessExpiresAt: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { ownedLeads: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateRole(
    organizationId: string,
    targetUserId: string,
    newRole: Role,
    actorId: string,
  ): Promise<Omit<User, 'passwordHash'>> {
    const targetUser = await this.prisma.user.findFirst({
      where: { id: targetUserId, organizationId },
    });

    if (!targetUser) {
      throw new NotFoundException(
        `User with ID "${targetUserId}" not found in this organization`,
      );
    }

    // Safety rule: Prevent self-demotion if actor is the only Super Admin
    if (
      targetUserId === actorId &&
      targetUser.role === Role.SUPER_ADMIN &&
      newRole !== Role.SUPER_ADMIN
    ) {
      const superAdminCount = await this.prisma.user.count({
        where: { organizationId, role: Role.SUPER_ADMIN, isActive: true },
      });
      if (superAdminCount <= 1) {
        throw new ConflictException(
          'Cannot demote the only active Super Admin in the organization',
        );
      }
    }

    const previousRole = targetUser.role;

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: newRole },
      select: {
        id: true,
        organizationId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        accessType: true,
        allowedIp: true,
        accessExpiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'user.role_changed',
        targetType: 'user',
        targetId: targetUserId,
        metadata: {
          previousRole,
          newRole,
          email: targetUser.email,
        },
      },
    });

    this.logger.log(
      `Role changed for user ${targetUser.email} from ${previousRole} to ${newRole} by actor ${actorId}`,
    );

    return updated;
  }

  async updateStatus(
    organizationId: string,
    targetUserId: string,
    isActive: boolean,
    actorId: string,
  ): Promise<Omit<User, 'passwordHash'>> {
    const targetUser = await this.prisma.user.findFirst({
      where: { id: targetUserId, organizationId },
    });

    if (!targetUser) {
      throw new NotFoundException(
        `User with ID "${targetUserId}" not found in this organization`,
      );
    }

    // Safety rule: Prevent self-deactivation
    if (targetUserId === actorId && !isActive) {
      throw new ConflictException(
        'You cannot deactivate your own administrative account',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { isActive },
      select: {
        id: true,
        organizationId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        accessType: true,
        allowedIp: true,
        accessExpiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: isActive ? 'user.reactivated' : 'user.deactivated',
        targetType: 'user',
        targetId: targetUserId,
        metadata: {
          email: targetUser.email,
          role: targetUser.role,
        },
      },
    });

    this.logger.log(
      `Account ${isActive ? 'reactivated' : 'deactivated'} for user ${targetUser.email} by actor ${actorId}`,
    );

    return updated;
  }

  async deleteMember(
    organizationId: string,
    targetUserId: string,
    actorId: string,
  ): Promise<{ success: boolean; message: string }> {
    // Defense-in-depth: Verify that the actor is an active SUPER_ADMIN
    const actor = await this.prisma.user.findFirst({
      where: { id: actorId, organizationId, isActive: true },
    });

    if (!actor || actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Access denied: Only a Super Admin can permanently delete a team member',
      );
    }

    const targetUser = await this.prisma.user.findFirst({
      where: { id: targetUserId, organizationId },
    });

    if (!targetUser) {
      throw new NotFoundException(
        `User with ID "${targetUserId}" not found in this organization`,
      );
    }

    // Safety rule 1: Prevent self-deletion
    if (targetUserId === actorId) {
      throw new BadRequestException('You cannot delete your own administrative account');
    }

    // Safety rule 2: Prevent deleting the only active Super Admin
    if (targetUser.role === Role.SUPER_ADMIN) {
      const superAdminCount = await this.prisma.user.count({
        where: { organizationId, role: Role.SUPER_ADMIN, isActive: true },
      });
      if (superAdminCount <= 1) {
        throw new ConflictException(
          'Cannot delete the only active Super Admin in the organization',
        );
      }
    }

    // Execute atomic transactional unlinking and permanent deletion
    await this.prisma.$transaction(async (tx) => {
      // 1. Unassign all leads owned by this user (preserves lead records safely)
      await tx.lead.updateMany({
        where: { organizationId, ownerId: targetUserId },
        data: { ownerId: null },
      });

      // 2. Clean up notifications addressed to this user
      await tx.notification.deleteMany({
        where: { recipientUserId: targetUserId },
      });

      // 3. Clean up reminders assigned to this user
      await tx.leadReminder.deleteMany({
        where: { organizationId, userId: targetUserId },
      });

      // 4. Clean up pending/issued invitations by this user
      await tx.invitation.deleteMany({
        where: { organizationId, invitedById: targetUserId },
      });

      // 5. Nullify historical user foreign keys on activities, imports, and audit logs
      await tx.leadActivity.updateMany({
        where: { organizationId, userId: targetUserId },
        data: { userId: null },
      });

      await tx.import.updateMany({
        where: { organizationId, userId: targetUserId },
        data: { userId: null },
      });

      await tx.auditLog.updateMany({
        where: { organizationId, actorId: targetUserId },
        data: { actorId: null },
      });

      // 6. Delete notes created by this user
      await tx.leadNote.deleteMany({
        where: { organizationId, userId: targetUserId },
      });

      // 7. Delete the user record completely from the database
      await tx.user.delete({
        where: { id: targetUserId },
      });

      // 8. Record audit log of this permanent deletion
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId,
          action: 'user.deleted',
          targetType: 'user',
          targetId: targetUserId,
          metadata: {
            email: targetUser.email,
            firstName: targetUser.firstName,
            lastName: targetUser.lastName,
            role: targetUser.role,
          },
        },
      });
    });

    this.logger.log(
      `Permanently deleted user "${targetUser.email}" (${targetUser.role}) from org "${organizationId}" by actor "${actorId}"`,
    );

    return {
      success: true,
      message: `User ${targetUser.email} has been permanently deleted from the database`,
    };
  }

  async updateUserIp(
    organizationId: string,
    targetUserId: string,
    dto: UpdateUserIpDto,
    actorId: string,
  ): Promise<Omit<User, 'passwordHash'>> {
    const targetUser = await this.prisma.user.findFirst({
      where: { id: targetUserId, organizationId },
    });

    if (!targetUser) {
      throw new NotFoundException(
        `User with ID "${targetUserId}" not found in this organization`,
      );
    }

    let normalizedAllowedIp: string | null = null;
    let accessType: AccessType | null = null;
    let parsedExpiresAt: Date | null = null;

    if (dto.allowedIp && dto.allowedIp.trim().length > 0) {
      if (!isValidIp(dto.allowedIp)) {
        throw new BadRequestException(
          'Please enter a valid IPv4 or IPv6 address (e.g. 203.0.113.25)',
        );
      }
      normalizedAllowedIp = normalizeIp(dto.allowedIp);
      accessType = dto.accessType || AccessType.PERMANENT;

      if (accessType === AccessType.TEMPORARY) {
        if (!dto.accessExpiresAt) {
          throw new BadRequestException(
            'Expiration date & time is required for temporary access',
          );
        }
        parsedExpiresAt = new Date(dto.accessExpiresAt);
        if (isNaN(parsedExpiresAt.getTime())) {
          throw new BadRequestException('Invalid expiration date format');
        }
        if (parsedExpiresAt <= new Date()) {
          throw new BadRequestException('Expiration date must be in the future');
        }
      }
    } else {
      // Removing IP restriction or explicitly set to null/empty
      normalizedAllowedIp = null;
      accessType = null;
      parsedExpiresAt = null;
    }

    const previousConfig = {
      allowedIp: targetUser.allowedIp,
      accessType: targetUser.accessType,
      accessExpiresAt: targetUser.accessExpiresAt
        ? targetUser.accessExpiresAt.toISOString()
        : null,
    };

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        allowedIp: normalizedAllowedIp,
        accessType,
        accessExpiresAt: parsedExpiresAt,
      },
      select: {
        id: true,
        organizationId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        accessType: true,
        allowedIp: true,
        accessExpiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'user.ip_renewed',
        targetType: 'user',
        targetId: targetUserId,
        metadata: {
          previousConfig,
          newConfig: {
            allowedIp: normalizedAllowedIp,
            accessType,
            accessExpiresAt: parsedExpiresAt ? parsedExpiresAt.toISOString() : null,
          },
          email: targetUser.email,
        },
      },
    });

    this.logger.log(
      `IP access configuration updated for user "${targetUser.email}" by actor "${actorId}" [IP: ${normalizedAllowedIp || 'None'}, Type: ${accessType || 'None'}]`,
    );

    return updated;
  }

  async adminResetPassword(
    organizationId: string,
    targetUserId: string,
    dto: AdminResetPasswordDto,
    actorId: string,
  ): Promise<{ success: boolean; message: string }> {
    const targetUser = await this.prisma.user.findFirst({
      where: { id: targetUserId, organizationId },
    });

    if (!targetUser) {
      throw new NotFoundException(
        `User with ID "${targetUserId}" not found in this organization`,
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { passwordHash },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'user.password_reset_by_admin',
        targetType: 'user',
        targetId: targetUserId,
        metadata: {
          email: targetUser.email,
        },
      },
    });

    this.logger.log(
      `Password reset for user "${targetUser.email}" in org "${organizationId}" by Super Admin "${actorId}"`,
    );

    return {
      success: true,
      message: `Password for ${targetUser.email} has been updated successfully.`,
    };
  }
}

