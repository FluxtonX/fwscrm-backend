import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { LeadSource } from '@prisma/client';

@Injectable()
export class LeadSourceService {
  constructor(private readonly prisma: PrismaService) {}

  async listByOrganization(organizationId: string): Promise<LeadSource[]> {
    return this.prisma.leadSource.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  async findOrCreate(
    organizationId: string,
    name: string,
  ): Promise<LeadSource> {
    const existing = await this.prisma.leadSource.findFirst({
      where: {
        organizationId,
        name: { equals: name, mode: 'insensitive' },
      },
    });

    if (existing) return existing;

    return this.prisma.leadSource.create({
      data: {
        organizationId,
        name,
      },
    });
  }
}
