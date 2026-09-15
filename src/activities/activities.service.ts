import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ActivityType, LeadActivity, Prisma } from '@prisma/client';

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
  ): Promise<LeadActivity[]> {
    // Verify lead belongs to organization
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID "${leadId}" not found`);
    }

    return this.prisma.leadActivity.findMany({
      where: {
        organizationId,
        leadId,
      },
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
  ): Promise<LeadActivity[]> {
    return this.prisma.leadActivity.findMany({
      where: { organizationId },
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
