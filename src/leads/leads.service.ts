import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Lead, ActivityType, Prisma } from '@prisma/client';
import { QueryLeadsDto } from './dto/query-leads.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { PaginatedResult } from '../common/interfaces/paginated-result.interface';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    organizationId: string,
    query: QueryLeadsDto,
  ): Promise<PaginatedResult<Lead>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 25));
    const skip = (page - 1) * limit;

    const where: Prisma.LeadWhereInput = {
      organizationId, // STRICT TENANT ISOLATION
    };

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
      ];
    }

    if (query.status) {
      where.OR = [
        ...(where.OR || []),
        { statusId: query.status },
        { status: { name: { equals: query.status, mode: 'insensitive' } } },
      ];
    }

    if (query.country) {
      where.countryName = { contains: query.country, mode: 'insensitive' };
    }

    if (query.leadSource) {
      where.sourceName = { contains: query.leadSource, mode: 'insensitive' };
    }

    if (query.ownerId) {
      where.ownerId = query.ownerId;
    }

    if (query.referrer) {
      where.referrer = { contains: query.referrer, mode: 'insensitive' };
    }

    if (query.tag1) {
      where.tag1 = { contains: query.tag1, mode: 'insensitive' };
    }

    // Safe sort column mapping
    const allowedSortColumns: Record<string, string> = {
      firstName: 'firstName',
      lastName: 'lastName',
      email: 'email',
      phone: 'phone',
      countryName: 'countryName',
      sourceName: 'sourceName',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    };

    const sortColumn =
      query.sort && allowedSortColumns[query.sort]
        ? allowedSortColumns[query.sort]
        : 'createdAt';
    const sortOrder = query.order?.toLowerCase() === 'asc' ? 'asc' : 'desc';

    const [total, data] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortColumn]: sortOrder },
        include: {
          status: { select: { id: true, name: true, color: true } },
          source: { select: { id: true, name: true } },
          country: { select: { id: true, name: true, isoCode: true } },
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findById(organizationId: string, id: string): Promise<Lead> {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        organizationId, // Strict tenant check
      },
      include: {
        status: true,
        source: true,
        country: true,
        subAffiliate: true,
        owner: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID "${id}" not found`);
    }

    return lead;
  }

  async create(
    organizationId: string,
    dto: CreateLeadDto,
    createdById?: string,
  ): Promise<Lead> {
    // Duplicate detection by email in the organization
    const existing = await this.prisma.lead.findFirst({
      where: {
        organizationId,
        email: { equals: dto.email.toLowerCase(), mode: 'insensitive' },
      },
    });

    if (existing) {
      throw new ConflictException(
        `A lead with email "${dto.email}" already exists in this organization`,
      );
    }

    // Country & Source auto-resolution / normalization
    let countryId = dto.countryId;
    let countryName = dto.country;
    if (dto.country && !countryId) {
      const c = await this.prisma.country.findFirst({
        where: { name: { equals: dto.country, mode: 'insensitive' } },
      });
      if (c) {
        countryId = c.id;
        countryName = c.name;
      }
    }

    let sourceId = dto.sourceId;
    let sourceName = dto.leadSource;
    if (dto.leadSource && !sourceId) {
      const s = await this.prisma.leadSource.findFirst({
        where: {
          organizationId,
          name: { equals: dto.leadSource, mode: 'insensitive' },
        },
      });
      if (s) {
        sourceId = s.id;
        sourceName = s.name;
      }
    }

    const lead = await this.prisma.lead.create({
      data: {
        organizationId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        countryId,
        countryName,
        sourceId,
        sourceName,
        referrer: dto.referrer,
        tag1: dto.tag1,
        statusId: dto.statusId,
        ownerId: dto.ownerId,
      },
    });

    // Create activity record
    await this.prisma.leadActivity.create({
      data: {
        organizationId,
        leadId: lead.id,
        userId: createdById,
        type: ActivityType.CREATED,
        description: `Lead created for ${lead.firstName} ${lead.lastName}`,
      },
    });

    this.logger.log(`Created lead ${lead.id} in org ${organizationId}`);
    return lead;
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateLeadDto,
    updatedById?: string,
  ): Promise<Lead> {
    await this.findById(organizationId, id); // Verify ownership

    const data: Prisma.LeadUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email.toLowerCase();
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.referrer !== undefined) data.referrer = dto.referrer;
    if (dto.tag1 !== undefined) data.tag1 = dto.tag1;
    if (dto.country !== undefined) data.countryName = dto.country;
    if (dto.leadSource !== undefined) data.sourceName = dto.leadSource;

    if (dto.statusId !== undefined) {
      data.status = dto.statusId
        ? { connect: { id: dto.statusId } }
        : { disconnect: true };
    }
    if (dto.ownerId !== undefined) {
      data.owner = dto.ownerId
        ? { connect: { id: dto.ownerId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data,
    });

    const activityType =
      dto.statusId !== undefined
        ? ActivityType.STATUS_CHANGED
        : dto.ownerId !== undefined
          ? ActivityType.OWNER_ASSIGNED
          : ActivityType.UPDATED;

    const activityDesc =
      dto.statusId !== undefined
        ? `Lead status updated`
        : dto.ownerId !== undefined
          ? `Lead assigned to new owner`
          : `Lead information updated`;

    await this.prisma.leadActivity.create({
      data: {
        organizationId,
        leadId: id,
        userId: updatedById,
        type: activityType,
        description: activityDesc,
      },
    });

    return updated;
  }

  async delete(
    organizationId: string,
    id: string,
  ): Promise<{ success: boolean }> {
    await this.findById(organizationId, id); // Verify ownership

    await this.prisma.lead.delete({
      where: { id },
    });

    this.logger.log(`Deleted lead ${id} in org ${organizationId}`);
    return { success: true };
  }

  async bulkAssign(
    organizationId: string,
    leadIds: string[],
    ownerId: string,
  ): Promise<{ count: number }> {
    const result = await this.prisma.lead.updateMany({
      where: {
        id: { in: leadIds },
        organizationId, // Strict tenant check
      },
      data: { ownerId },
    });

    // Create bulk activity logs
    if (leadIds.length > 0) {
      await this.prisma.leadActivity.createMany({
        data: leadIds.map((leadId) => ({
          organizationId,
          leadId,
          type: ActivityType.OWNER_ASSIGNED,
          description: `Assigned in bulk operation`,
        })),
      });
    }

    this.logger.log(
      `Bulk assigned ${result.count} leads to owner ${ownerId} in org ${organizationId}`,
    );
    return { count: result.count };
  }

  async bulkUpdateStatus(
    organizationId: string,
    leadIds: string[],
    statusId: string,
  ): Promise<{ count: number }> {
    const result = await this.prisma.lead.updateMany({
      where: {
        id: { in: leadIds },
        organizationId, // Strict tenant check
      },
      data: { statusId },
    });

    // Create bulk activity logs
    if (leadIds.length > 0) {
      await this.prisma.leadActivity.createMany({
        data: leadIds.map((leadId) => ({
          organizationId,
          leadId,
          type: ActivityType.STATUS_CHANGED,
          description: `Status changed in bulk operation`,
        })),
      });
    }

    this.logger.log(
      `Bulk updated status to ${statusId} for ${result.count} leads in org ${organizationId}`,
    );
    return { count: result.count };
  }

  async bulkDelete(
    organizationId: string,
    leadIds: string[],
  ): Promise<{ count: number }> {
    const result = await this.prisma.lead.deleteMany({
      where: {
        id: { in: leadIds },
        organizationId, // Strict tenant check
      },
    });

    this.logger.log(
      `Bulk deleted ${result.count} leads in org ${organizationId}`,
    );
    return { count: result.count };
  }

  sanitizeCsvField(val: unknown): string {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    // Formula injection defense (OWASP CSV Injection prevention)
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    return `"${str.replace(/"/g, '""')}"`;
  }

  async exportLeadsToCsv(
    organizationId: string,
    query: QueryLeadsDto,
    specificLeadIds?: string[],
  ): Promise<string> {
    const where: Prisma.LeadWhereInput = {
      organizationId,
    };

    if (specificLeadIds && specificLeadIds.length > 0) {
      where.id = { in: specificLeadIds };
    } else {
      if (query.search && query.search.trim()) {
        const s = query.search.trim();
        where.OR = [
          { firstName: { contains: s, mode: 'insensitive' } },
          { lastName: { contains: s, mode: 'insensitive' } },
          { email: { contains: s, mode: 'insensitive' } },
          { phone: { contains: s, mode: 'insensitive' } },
        ];
      }
      if (query.status) {
        where.statusId = query.status;
      }
      if (query.country) {
        where.countryName = { contains: query.country, mode: 'insensitive' };
      }
      if (query.leadSource) {
        where.sourceName = { contains: query.leadSource, mode: 'insensitive' };
      }
      if (query.ownerId) {
        where.ownerId = query.ownerId;
      }
    }

    const leads = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000,
      include: {
        status: { select: { name: true } },
        source: { select: { name: true } },
        country: { select: { name: true } },
        owner: { select: { firstName: true, lastName: true } },
      },
    });

    const headers = [
      'First Name',
      'Last Name',
      'Email',
      'Phone',
      'Country',
      'Lead Source',
      'referrer',
      'tag1',
      'Status',
      'Owner',
      'Created At',
    ];

    const rows = leads.map((l) => [
      this.sanitizeCsvField(l.firstName),
      this.sanitizeCsvField(l.lastName),
      this.sanitizeCsvField(l.email),
      this.sanitizeCsvField(l.phone || ''),
      this.sanitizeCsvField(l.countryName || l.country?.name || ''),
      this.sanitizeCsvField(l.sourceName || l.source?.name || ''),
      this.sanitizeCsvField(l.referrer || ''),
      this.sanitizeCsvField(l.tag1 || ''),
      this.sanitizeCsvField(l.status?.name || ''),
      this.sanitizeCsvField(
        l.owner ? `${l.owner.firstName} ${l.owner.lastName}` : '',
      ),
      this.sanitizeCsvField(l.createdAt.toISOString()),
    ]);

    const csvContent = [
      headers.map((h) => `"${h}"`).join(','),
      ...rows.map((r) => r.join(',')),
    ].join('\r\n');

    this.logger.log(`Exported ${leads.length} leads for org ${organizationId}`);
    return csvContent;
  }
}
