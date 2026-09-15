import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { User, Role } from '@prisma/client';

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

  constructor(private readonly prisma: PrismaService) {}

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
}
