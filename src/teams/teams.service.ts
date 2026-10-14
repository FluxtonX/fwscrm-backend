import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createTeam(
    organizationId: string,
    actorId: string,
    dto: CreateTeamDto,
  ) {
    const existing = await this.prisma.team.findUnique({
      where: {
        organizationId_name: {
          organizationId,
          name: dto.name,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Team with name "${dto.name}" already exists`);
    }

    if (dto.managerId) {
      const managerUser = await this.prisma.user.findFirst({
        where: {
          id: dto.managerId,
          organizationId,
          isActive: true,
        },
      });

      if (!managerUser) {
        throw new BadRequestException(
          'Selected manager does not exist or is not an active member in this organization',
        );
      }
    }

    const team = await this.prisma.team.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description,
        managerId: dto.managerId || null,
      },
      include: {
        manager: {
          select: {
            id: true,
            username: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
              },
            },
          },
        },
        _count: {
          select: {
            members: true,
          },
        },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'team.created',
        targetType: 'team',
        targetId: team.id,
        metadata: {
          name: team.name,
          managerId: team.managerId,
        },
      },
    });

    this.logger.log(`Created team "${team.name}" in org "${organizationId}" by actor "${actorId}"`);
    return team;
  }

  async listTeams(organizationId: string, actorId: string, role: Role) {
    const isSuperAdminOrAdmin = role === Role.SUPER_ADMIN || role === Role.ADMIN;

    const where: any = { organizationId };
    if (!isSuperAdminOrAdmin) {
      // Manager views team(s) they manage or belong to
      where.OR = [
        { managerId: actorId },
        { members: { some: { userId: actorId } } },
      ];
    }

    return this.prisma.team.findMany({
      where,
      include: {
        manager: {
          select: {
            id: true,
            username: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
              },
            },
          },
        },
        _count: {
          select: {
            members: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyTeam(organizationId: string, userId: string) {
    const team = await this.prisma.team.findFirst({
      where: {
        organizationId,
        OR: [
          { managerId: userId },
          { members: { some: { userId } } },
        ],
      },
      include: {
        manager: {
          select: {
            id: true,
            username: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
              },
            },
          },
        },
        _count: {
          select: {
            members: true,
          },
        },
      },
    });

    return team;
  }

  async getTeamById(organizationId: string, teamId: string) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId },
      include: {
        manager: {
          select: {
            id: true,
            username: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
              },
            },
          },
        },
        _count: {
          select: {
            members: true,
          },
        },
      },
    });

    if (!team) {
      throw new NotFoundException(`Team with ID "${teamId}" not found`);
    }

    return team;
  }

  async updateTeam(
    organizationId: string,
    teamId: string,
    actorId: string,
    dto: UpdateTeamDto,
  ) {
    const existing = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId },
    });

    if (!existing) {
      throw new NotFoundException(`Team with ID "${teamId}" not found`);
    }

    if (dto.name && dto.name !== existing.name) {
      const duplicate = await this.prisma.team.findUnique({
        where: {
          organizationId_name: {
            organizationId,
            name: dto.name,
          },
        },
      });
      if (duplicate) {
        throw new ConflictException(`Team with name "${dto.name}" already exists`);
      }
    }

    if (dto.managerId) {
      const managerUser = await this.prisma.user.findFirst({
        where: {
          id: dto.managerId,
          organizationId,
          isActive: true,
        },
      });

      if (!managerUser) {
        throw new BadRequestException(
          'Selected manager does not exist or is not active in this organization',
        );
      }
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.managerId !== undefined) data.managerId = dto.managerId;

    const updated = await this.prisma.team.update({
      where: { id: teamId },
      data,
      include: {
        manager: {
          select: {
            id: true,
            username: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                isActive: true,
              },
            },
          },
        },
        _count: {
          select: {
            members: true,
          },
        },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'team.updated',
        targetType: 'team',
        targetId: teamId,
        metadata: {
          previous: { name: existing.name, managerId: existing.managerId },
          updated: { name: updated.name, managerId: updated.managerId },
        },
      },
    });

    this.logger.log(`Updated team "${teamId}" in org "${organizationId}" by actor "${actorId}"`);
    return updated;
  }

  async deleteTeam(
    organizationId: string,
    teamId: string,
    actorId: string,
  ): Promise<{ success: boolean; message: string }> {
    const existing = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId },
    });

    if (!existing) {
      throw new NotFoundException(`Team with ID "${teamId}" not found`);
    }

    await this.prisma.team.delete({
      where: { id: teamId },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'team.deleted',
        targetType: 'team',
        targetId: teamId,
        metadata: {
          name: existing.name,
        },
      },
    });

    this.logger.log(`Deleted team "${existing.name}" in org "${organizationId}" by actor "${actorId}"`);
    return {
      success: true,
      message: `Team "${existing.name}" has been deleted`,
    };
  }

  async addMember(
    organizationId: string,
    teamId: string,
    actorId: string,
    dto: AddTeamMemberDto,
  ) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId },
    });

    if (!team) {
      throw new NotFoundException(`Team with ID "${teamId}" not found`);
    }

    const targetUser = await this.prisma.user.findFirst({
      where: { id: dto.userId, organizationId, isActive: true },
    });

    if (!targetUser) {
      throw new BadRequestException('Target user not found or inactive in this organization');
    }

    const existingMember = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: dto.userId,
        },
      },
    });

    if (existingMember) {
      throw new ConflictException('User is already a member of this team');
    }

    const teamMember = await this.prisma.teamMember.create({
      data: {
        teamId,
        userId: dto.userId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            isActive: true,
          },
        },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'team.member_added',
        targetType: 'team',
        targetId: teamId,
        metadata: {
          userId: dto.userId,
          userEmail: targetUser.email,
        },
      },
    });

    this.logger.log(`Added user "${targetUser.email}" to team "${team.name}" by actor "${actorId}"`);
    return teamMember;
  }

  async removeMember(
    organizationId: string,
    teamId: string,
    userId: string,
    actorId: string,
  ): Promise<{ success: boolean; message: string }> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId },
    });

    if (!team) {
      throw new NotFoundException(`Team with ID "${teamId}" not found`);
    }

    const teamMember = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId,
        },
      },
    });

    if (!teamMember) {
      throw new NotFoundException('User is not a member of this team');
    }

    await this.prisma.teamMember.delete({
      where: {
        teamId_userId: {
          teamId,
          userId,
        },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: 'team.member_removed',
        targetType: 'team',
        targetId: teamId,
        metadata: {
          userId,
        },
      },
    });

    this.logger.log(`Removed user "${userId}" from team "${team.name}" by actor "${actorId}"`);
    return {
      success: true,
      message: 'Team member removed successfully',
    };
  }
}
