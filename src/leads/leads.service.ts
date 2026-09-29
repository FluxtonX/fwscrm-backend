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
    currentUserId?: string,
  ): Promise<PaginatedResult<Lead>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 25));
    const skip = (page - 1) * limit;

    const andConditions: Prisma.LeadWhereInput[] = [
      { organizationId }, // STRICT TENANT ISOLATION
    ];

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      andConditions.push({
        OR: [
          { firstName: { contains: s, mode: 'insensitive' } },
          { lastName: { contains: s, mode: 'insensitive' } },
          { email: { contains: s, mode: 'insensitive' } },
          { phone: { contains: s, mode: 'insensitive' } },
        ],
      });
    }

    if (query.status) {
      const statusList = query.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statusList.length === 1) {
        andConditions.push({
          OR: [
            { statusId: statusList[0] },
            { status: { name: { equals: statusList[0], mode: 'insensitive' } } },
          ],
        });
      } else if (statusList.length > 1) {
        andConditions.push({
          OR: [
            { statusId: { in: statusList } },
            { status: { name: { in: statusList, mode: 'insensitive' } } },
          ],
        });
      }
    }

    if (query.dateFrom || query.dateTo) {
      const createdAtFilter: Prisma.DateTimeFilter = {};
      if (query.dateFrom) {
        const fromDate = new Date(query.dateFrom);
        if (!isNaN(fromDate.getTime())) {
          createdAtFilter.gte = fromDate;
        }
      }
      if (query.dateTo) {
        const toDate = new Date(query.dateTo);
        if (!isNaN(toDate.getTime())) {
          if (query.dateTo.length <= 10) {
            toDate.setHours(23, 59, 59, 999);
          }
          createdAtFilter.lte = toDate;
        }
      }
      if (createdAtFilter.gte || createdAtFilter.lte) {
        andConditions.push({ createdAt: createdAtFilter });
      }
    }

    if (query.country) {
      andConditions.push({
        countryName: { contains: query.country, mode: 'insensitive' },
      });
    }

    if (query.leadSource) {
      andConditions.push({
        sourceName: { contains: query.leadSource, mode: 'insensitive' },
      });
    }

    if (query.ownerId) {
      if (query.ownerId === 'unassigned') {
        andConditions.push({ ownerId: null });
      } else {
        andConditions.push({ ownerId: query.ownerId });
      }
    }

    if (query.referrer) {
      andConditions.push({
        referrer: { contains: query.referrer, mode: 'insensitive' },
      });
    }

    if (query.tag1) {
      andConditions.push({
        tag1: { contains: query.tag1, mode: 'insensitive' },
      });
    }

    // Smart View Presets
    if (query.preset) {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      switch (query.preset) {
        case 'my_leads':
          if (currentUserId) {
            andConditions.push({ ownerId: currentUserId });
          }
          break;
        case 'follow_up_today':
          andConditions.push({
            reminders: {
              some: {
                isCompleted: false,
                dueDate: { gte: startOfToday, lte: endOfToday },
              },
            },
          });
          break;
        case 'overdue':
          andConditions.push({
            reminders: {
              some: {
                isCompleted: false,
                dueDate: { lt: startOfToday },
              },
            },
          });
          break;
        case 'upcoming':
          andConditions.push({
            reminders: {
              some: {
                isCompleted: false,
                dueDate: { gt: endOfToday },
              },
            },
          });
          break;
        case 'unassigned':
          andConditions.push({ ownerId: null });
          break;
        case 'recent':
          const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          andConditions.push({ createdAt: { gte: last7Days } });
          break;
        case 'all':
        default:
          break;
      }
    }

    const where: Prisma.LeadWhereInput =
      andConditions.length === 1
        ? andConditions[0]
        : { AND: andConditions };



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
    const existing = await this.findById(organizationId, id); // Verify ownership

    const data: Prisma.LeadUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email.toLowerCase();
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.referrer !== undefined) data.referrer = dto.referrer;
    if (dto.tag1 !== undefined) data.tag1 = dto.tag1;
    if (dto.country !== undefined) data.countryName = dto.country;
    if (dto.leadSource !== undefined) data.sourceName = dto.leadSource;

    let newStatusName = '';
    if (dto.statusId !== undefined) {
      data.status = dto.statusId
        ? { connect: { id: dto.statusId } }
        : { disconnect: true };

      if (dto.statusId) {
        const s = await this.prisma.leadStatus.findFirst({
          where: { id: dto.statusId, organizationId },
        });
        if (s) newStatusName = s.name;
      }
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

    const isStatusChanged =
      dto.statusId !== undefined && dto.statusId !== existing.statusId;

    let oldStatusName = 'Unassigned';
    if (isStatusChanged && existing.statusId) {
      const prev = await this.prisma.leadStatus.findFirst({
        where: { id: existing.statusId, organizationId },
      });
      if (prev) oldStatusName = prev.name;
    }

    const activityType = isStatusChanged
      ? ActivityType.STATUS_CHANGED
      : dto.ownerId !== undefined
        ? ActivityType.OWNER_ASSIGNED
        : ActivityType.UPDATED;

    const activityDesc = isStatusChanged
      ? `Status changed from "${oldStatusName}" to "${newStatusName || 'Unassigned'}"`
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
        metadata: isStatusChanged
          ? {
              fromStatusId: existing.statusId,
              fromStatusName: oldStatusName,
              toStatusId: dto.statusId,
              toStatusName: newStatusName || 'Unassigned',
            }
          : undefined,
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

    const statusRecord = await this.prisma.leadStatus.findFirst({
      where: { id: statusId, organizationId },
    });
    const statusName = statusRecord ? statusRecord.name : statusId;

    // Create bulk activity logs
    if (leadIds.length > 0) {
      await this.prisma.leadActivity.createMany({
        data: leadIds.map((leadId) => ({
          organizationId,
          leadId,
          type: ActivityType.STATUS_CHANGED,
          description: `Status changed to "${statusName}"`,
          metadata: {
            toStatusId: statusId,
            toStatusName: statusName,
          },
        })),
      });
    }

    this.logger.log(
      `Bulk updated status to ${statusName} (${statusId}) for ${result.count} leads in org ${organizationId}`,
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

  async bulkTag(
    organizationId: string,
    leadIds: string[],
    tag: string,
    action: 'ADD' | 'REMOVE' | 'SET' = 'ADD',
  ): Promise<{ count: number }> {
    const leads = await this.prisma.lead.findMany({
      where: {
        id: { in: leadIds },
        organizationId,
      },
      select: { id: true, tag1: true },
    });

    const updatedIds: string[] = [];
    const cleanTag = tag.trim();
    if (!cleanTag) return { count: 0 };

    for (const lead of leads) {
      let currentTags = lead.tag1
        ? lead.tag1.split(',').map((t) => t.trim()).filter(Boolean)
        : [];
      let newTagStr: string | null = lead.tag1;

      if (action === 'ADD') {
        if (!currentTags.some((t) => t.toLowerCase() === cleanTag.toLowerCase())) {
          currentTags.push(cleanTag);
          newTagStr = currentTags.join(', ');
        }
      } else if (action === 'REMOVE') {
        currentTags = currentTags.filter(
          (t) => t.toLowerCase() !== cleanTag.toLowerCase(),
        );
        newTagStr = currentTags.length > 0 ? currentTags.join(', ') : null;
      } else if (action === 'SET') {
        newTagStr = cleanTag;
      }

      if (newTagStr !== lead.tag1) {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { tag1: newTagStr },
        });
        updatedIds.push(lead.id);
      }
    }

    if (updatedIds.length > 0) {
      const descAction =
        action === 'ADD'
          ? 'Added tag'
          : action === 'REMOVE'
          ? 'Removed tag'
          : 'Set tag';
      await this.prisma.leadActivity.createMany({
        data: updatedIds.map((leadId) => ({
          organizationId,
          leadId,
          type: ActivityType.UPDATED,
          description: `Bulk tag updated: ${descAction} "${cleanTag}"`,
        })),
      });
    }

    this.logger.log(
      `Bulk tagged ${updatedIds.length} leads in org ${organizationId} with tag "${cleanTag}" (${action})`,
    );
    return { count: updatedIds.length };
  }

  async bulkEdit(
    organizationId: string,
    leadIds: string[],
    data: {
      statusId?: string;
      ownerId?: string;
      tag?: string;
      tagAction?: 'ADD' | 'REMOVE' | 'SET';
    },
  ): Promise<{ count: number; updatedFields: string[] }> {
    if (!leadIds || leadIds.length === 0) {
      return { count: 0, updatedFields: [] };
    }

    const updateData: { statusId?: string; ownerId?: string | null } = {};
    const activitiesToCreate: {
      organizationId: string;
      leadId: string;
      type: ActivityType;
      description: string;
      metadata?: any;
    }[] = [];
    const updatedFields: string[] = [];

    // 1. Status update
    if (data.statusId && data.statusId !== 'no_change') {
      const statusRecord = await this.prisma.leadStatus.findFirst({
        where: { id: data.statusId, organizationId },
      });
      const statusName = statusRecord ? statusRecord.name : data.statusId;

      updateData.statusId = data.statusId;
      updatedFields.push('status');
      for (const leadId of leadIds) {
        activitiesToCreate.push({
          organizationId,
          leadId,
          type: ActivityType.STATUS_CHANGED,
          description: `Status changed to "${statusName}"`,
          metadata: {
            toStatusId: data.statusId,
            toStatusName: statusName,
          },
        });
      }
    }

    // 2. Owner update
    if (data.ownerId && data.ownerId !== 'no_change') {
      const targetOwner =
        data.ownerId === 'unassigned' || data.ownerId === 'none'
          ? null
          : data.ownerId;
      updateData.ownerId = targetOwner;
      updatedFields.push('owner');
      for (const leadId of leadIds) {
        activitiesToCreate.push({
          organizationId,
          leadId,
          type: ActivityType.OWNER_ASSIGNED,
          description: targetOwner
            ? `Assigned in bulk edit`
            : `Unassigned in bulk edit`,
        });
      }
    }

    let affectedCount = leadIds.length;

    // Apply lead table updates
    if (Object.keys(updateData).length > 0) {
      const result = await this.prisma.lead.updateMany({
        where: {
          id: { in: leadIds },
          organizationId,
        },
        data: updateData,
      });
      affectedCount = result.count;
    }

    // 3. Tag update
    if (data.tag && data.tag.trim()) {
      const cleanTag = data.tag.trim();
      const action = data.tagAction || 'ADD';
      await this.bulkTag(organizationId, leadIds, cleanTag, action);
      updatedFields.push('tag');
    }

    // Create activity logs
    if (activitiesToCreate.length > 0) {
      await this.prisma.leadActivity.createMany({
        data: activitiesToCreate,
      });
    }

    this.logger.log(
      `Bulk edited ${affectedCount} leads in org ${organizationId}: updated [${updatedFields.join(', ')}]`,
    );

    return { count: affectedCount, updatedFields };
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
    const andConditions: Prisma.LeadWhereInput[] = [
      { organizationId },
    ];

    if (specificLeadIds && specificLeadIds.length > 0) {
      andConditions.push({ id: { in: specificLeadIds } });
    } else {
      if (query.search && query.search.trim()) {
        const s = query.search.trim();
        andConditions.push({
          OR: [
            { firstName: { contains: s, mode: 'insensitive' } },
            { lastName: { contains: s, mode: 'insensitive' } },
            { email: { contains: s, mode: 'insensitive' } },
            { phone: { contains: s, mode: 'insensitive' } },
          ],
        });
      }

      if (query.status) {
        const statusList = query.status.split(',').map((s) => s.trim()).filter(Boolean);
        if (statusList.length === 1) {
          andConditions.push({
            OR: [
              { statusId: statusList[0] },
              { status: { name: { equals: statusList[0], mode: 'insensitive' } } },
            ],
          });
        } else if (statusList.length > 1) {
          andConditions.push({
            OR: [
              { statusId: { in: statusList } },
              { status: { name: { in: statusList, mode: 'insensitive' } } },
            ],
          });
        }
      }

      if (query.country) {
        andConditions.push({
          countryName: { contains: query.country, mode: 'insensitive' },
        });
      }

      if (query.leadSource) {
        andConditions.push({
          sourceName: { contains: query.leadSource, mode: 'insensitive' },
        });
      }

      if (query.ownerId) {
        if (query.ownerId === 'unassigned') {
          andConditions.push({ ownerId: null });
        } else {
          andConditions.push({ ownerId: query.ownerId });
        }
      }

      if (query.referrer) {
        andConditions.push({
          referrer: { contains: query.referrer, mode: 'insensitive' },
        });
      }

      if (query.tag1) {
        andConditions.push({
          tag1: { contains: query.tag1, mode: 'insensitive' },
        });
      }

      if (query.dateFrom || query.dateTo) {
        const createdAtFilter: Prisma.DateTimeFilter = {};
        if (query.dateFrom) {
          const fromDate = new Date(query.dateFrom);
          if (!isNaN(fromDate.getTime())) {
            createdAtFilter.gte = fromDate;
          }
        }
        if (query.dateTo) {
          const toDate = new Date(query.dateTo);
          if (!isNaN(toDate.getTime())) {
            if (query.dateTo.length <= 10) {
              toDate.setHours(23, 59, 59, 999);
            }
            createdAtFilter.lte = toDate;
          }
        }
        if (createdAtFilter.gte || createdAtFilter.lte) {
          andConditions.push({ createdAt: createdAtFilter });
        }
      }
    }

    const where: Prisma.LeadWhereInput =
      andConditions.length === 1 ? andConditions[0] : { AND: andConditions };

    const leads = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50000,
      include: {
        status: { select: { name: true } },
        source: { select: { name: true } },
        country: { select: { name: true } },
        owner: { select: { firstName: true, lastName: true } },
      },
    });

    const allColumns: { id: string; label: string; getValue: (l: any) => string }[] = [
      { id: 'firstName', label: 'First Name', getValue: (l) => l.firstName || '' },
      { id: 'lastName', label: 'Last Name', getValue: (l) => l.lastName || '' },
      { id: 'email', label: 'Email', getValue: (l) => l.email || '' },
      { id: 'phone', label: 'Phone', getValue: (l) => l.phone || '' },
      { id: 'country', label: 'Country', getValue: (l) => l.countryName || l.country?.name || '' },
      { id: 'leadSource', label: 'Lead Source', getValue: (l) => l.sourceName || l.source?.name || '' },
      { id: 'referrer', label: 'Referrer', getValue: (l) => l.referrer || '' },
      { id: 'tag1', label: 'Tags', getValue: (l) => l.tag1 || '' },
      { id: 'status', label: 'Status', getValue: (l) => l.status?.name || '' },
      { id: 'owner', label: 'Owner', getValue: (l) => (l.owner ? `${l.owner.firstName} ${l.owner.lastName}`.trim() : '') },
      { id: 'createdAt', label: 'Created At', getValue: (l) => (l.createdAt ? new Date(l.createdAt).toISOString() : '') },
    ];

    let selectedColumns = allColumns;
    if (query.columns && query.columns.trim()) {
      const requestedIds = query.columns.split(',').map((c) => c.trim().toLowerCase());
      const filtered = allColumns.filter(
        (col) =>
          requestedIds.includes(col.id.toLowerCase()) ||
          requestedIds.includes(col.label.toLowerCase()),
      );
      if (filtered.length > 0) {
        selectedColumns = filtered;
      }
    }

    const headers = selectedColumns.map((col) => col.label);
    const rows = leads.map((l) =>
      selectedColumns.map((col) => this.sanitizeCsvField(col.getValue(l))),
    );

    const csvContent = [
      headers.map((h) => `"${h}"`).join(','),
      ...rows.map((r) => r.join(',')),
    ].join('\r\n');

    this.logger.log(`Exported ${leads.length} leads for org ${organizationId}`);
    return '\uFEFF' + csvContent;
  }
}
