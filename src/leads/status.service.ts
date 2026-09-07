import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { LeadStatus } from '@prisma/client';

@Injectable()
export class LeadStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async listByOrganization(organizationId: string): Promise<LeadStatus[]> {
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
        color: '#0D9488',
        order: 1,
        isDefault: true,
      },
    });
  }
}
