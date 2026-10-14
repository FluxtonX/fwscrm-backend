import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ActivityType, LeadActivity, Prisma, Role } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

@Injectable()
export class ActivitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async logActivity(
    organizationId: string,
    leadId: string,
    type: ActivityType,
    description: string,
    userId?: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<LeadActivity> {
    return this.prisma.leadActivity.create({
      data: {
        organizationId,
        leadId,
        type,
        description,
        userId,
        metadata: metadata ?? undefined,
      },
    });
  }

  async getLeadActivities(
    organizationId: string,
    leadId: string,
    role?: Role,
    actor?: AuthenticatedUser,
  ): Promise<LeadActivity[]> {
    // Verify lead belongs to organization
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID "${leadId}" not found`);
    }

    if (actor) {
      const isOperator = actor.role === Role.OPERATOR || actor.role === Role.AGENT;
      const isManager = actor.role === Role.MANAGER;

      if (isOperator && lead.ownerId !== actor.id) {
        throw new ForbiddenException(
          'You do not have permission to view activities for this lead',
        );
      }

      if (isManager) {
        const managedTeams = await this.prisma.team.findMany({
          where: {
            organizationId,
            OR: [
              { managerId: actor.id },
              { members: { some: { userId: actor.id } } },
            ],
          },
          include: { members: { select: { userId: true } } },
        });

        const teamMemberIds = new Set<string>();
        teamMemberIds.add(actor.id);
        for (const t of managedTeams) {
          if (t.managerId) teamMemberIds.add(t.managerId);
          for (const m of t.members) teamMemberIds.add(m.userId);
        }

        if (!lead.ownerId || !teamMemberIds.has(lead.ownerId)) {
          throw new ForbiddenException(
            'You do not have permission to view activities for leads outside your assigned team',
          );
        }
      }
    }

    const whereClause: Prisma.LeadActivityWhereInput = {
      organizationId,
      leadId,
    };

    if (role === Role.OPERATOR || role === Role.AGENT) {
      whereClause.type = {
        in: [
          ActivityType.CREATED,
          ActivityType.STATUS_CHANGED,
          ActivityType.NOTE_ADDED,
          ActivityType.UPDATED,
        ],
      };
    }

    return this.prisma.leadActivity.findMany({
      where: whereClause,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getOrganizationActivities(
    organizationId: string,
    limit = 10,
    role?: Role,
    actor?: AuthenticatedUser,
  ): Promise<LeadActivity[]> {
    const whereClause: Prisma.LeadActivityWhereInput = {
      organizationId,
    };

    const effectiveRole = actor?.role || role;
    const isOperator = effectiveRole === Role.OPERATOR || effectiveRole === Role.AGENT;
    const isManager = effectiveRole === Role.MANAGER;

    if (isOperator) {
      whereClause.type = {
        in: [
          ActivityType.CREATED,
          ActivityType.STATUS_CHANGED,
          ActivityType.NOTE_ADDED,
          ActivityType.UPDATED,
        ],
      };
      if (actor) {
        whereClause.OR = [
          { userId: actor.id },
          { lead: { ownerId: actor.id } },
        ];
      }
    } else if (isManager && actor) {
      const managedTeams = await this.prisma.team.findMany({
        where: {
          organizationId,
          OR: [
            { managerId: actor.id },
            { members: { some: { userId: actor.id } } },
          ],
        },
        include: { members: { select: { userId: true } } },
      });

      const teamMemberIds = new Set<string>();
      teamMemberIds.add(actor.id);
      for (const t of managedTeams) {
        if (t.managerId) teamMemberIds.add(t.managerId);
        for (const m of t.members) teamMemberIds.add(m.userId);
      }

      whereClause.OR = [
        { userId: { in: Array.from(teamMemberIds) } },
        { lead: { ownerId: { in: Array.from(teamMemberIds) } } },
      ];
    }

    return this.prisma.leadActivity.findMany({
      where: whereClause,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
        lead: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(50, Math.max(1, limit)),
    });
  }
}
