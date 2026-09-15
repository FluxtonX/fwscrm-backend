import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { LeadStatus } from '@prisma/client';

export const DEFAULT_LEAD_STATUSES = [
  { name: 'New', color: '#0284C7', order: 1, isDefault: true },
  { name: 'No Answer', color: '#F59E0B', order: 2, isDefault: false },
  { name: 'Wrong Number', color: '#EF4444', order: 3, isDefault: false },
  { name: 'Not Interested', color: '#64748B', order: 4, isDefault: false },
  { name: 'Appointments', color: '#6366F1', order: 5, isDefault: false },
  { name: 'Contacted', color: '#0D9488', order: 6, isDefault: false },
  { name: 'Qualified', color: '#10B981', order: 7, isDefault: false },
  { name: 'Proposal Sent', color: '#8B5CF6', order: 8, isDefault: false },
  { name: 'Customer', color: '#059669', order: 9, isDefault: false },
  { name: 'Lost', color: '#DC2626', order: 10, isDefault: false },
];

@Injectable()
export class LeadStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaultStatuses(organizationId: string): Promise<void> {
    const existing = await this.prisma.leadStatus.findMany({
      where: { organizationId },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((s) => s.name.toLowerCase()));

    for (const status of DEFAULT_LEAD_STATUSES) {
      if (!existingNames.has(status.name.toLowerCase())) {
        await this.prisma.leadStatus.create({
          data: {
            organizationId,
            name: status.name,
            color: status.color,
            order: status.order,
            isDefault: status.isDefault,
          },
        });
      }
    }
  }

  async listByOrganization(organizationId: string): Promise<LeadStatus[]> {
    // Ensure all standard sales statuses exist for the tenant
    await this.ensureDefaultStatuses(organizationId);

    return this.prisma.leadStatus.findMany({
      where: { organizationId },
      orderBy: { order: 'asc' },
    });
  }

  async findOrCreateDefault(organizationId: string): Promise<LeadStatus> {
    const existing = await this.prisma.leadStatus.findFirst({
      where: { organizationId, isDefault: true },
    });

    if (existing) return existing;

    return this.prisma.leadStatus.create({
      data: {
        organizationId,
        name: 'New',
        color: '#0284C7',
        order: 1,
        isDefault: true,
      },
    });
  }
}
