import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface DashboardPayload {
  overview: {
    totalLeads: number;
    activeLeads: number;
    wonLeads: number;
    lostLeads: number;
    conversionRate: number;
    leadsThisPeriod: number;
    leadsPreviousPeriod: number;
    leadsGrowthRate: number;
    totalImports: number;
    duplicateLeadsPrevented: number;
  };
  timeframe: string;
  pipeline: Array<{
    statusId: string | null;
    name: string;
    color: string;
    order: number;
    count: number;
    percentage: number;
  }>;
  sources: Array<{
    name: string;
    count: number;
    percentage: number;
  }>;
  trends: Array<{
    date: string;
    label: string;
    count: number;
  }>;
  teamPerformance: Array<{
    userId: string;
    name: string;
    email: string;
    assignedCount: number;
    wonCount: number;
    conversionRate: number;
  }>;
  actionItems: {
    unassignedCount: number;
    uncontactedCount: number;
    staleCount: number;
    items: Array<{
      id: string;
      title: string;
      reason: string;
      severity: 'high' | 'medium' | 'low';
      leadId?: string;
      leadName?: string;
    }>;
  };
  recentLeads: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    statusName?: string | null;
    statusColor?: string | null;
    sourceName?: string | null;
    ownerName?: string | null;
    createdAt: string;
  }>;
  recentActivities: Array<{
    id: string;
    type: string;
    description: string;
    createdAt: string;
    user?: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    } | null;
    lead?: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    } | null;
  }>;
  insights: Array<{
    id: string;
    type: 'positive' | 'warning' | 'info';
    text: string;
  }>;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private getDateRange(timeframe: string): {
    start: Date;
    previousStart: Date;
    days: number;
  } {
    const now = new Date();
    let days = 30;

    switch (timeframe) {
      case 'today':
        days = 1;
        break;
      case '7d':
        days = 7;
        break;
      case 'month':
        days = now.getDate();
        break;
      case 'all':
        days = 365;
        break;
      case '30d':
      default:
        days = 30;
        break;
    }

    const start = new Date(now);
    start.setDate(now.getDate() - days);
    start.setHours(0, 0, 0, 0);

    const previousStart = new Date(start);
    previousStart.setDate(start.getDate() - days);

    return { start, previousStart, days };
  }

  async getDashboard(
    organizationId: string,
    timeframe = '30d',
  ): Promise<DashboardPayload> {
    const { start, previousStart, days } = this.getDateRange(timeframe);

    // Run parallel database queries with strict organizationId filter
    const [
      totalLeads,
      leadsThisPeriod,
      leadsPreviousPeriod,
      wonLeads,
      lostLeads,
      totalImports,
      importStats,
      statusGroups,
      statuses,
      sourceGroups,
      users,
      unassignedCount,
      uncontactedCount,
      staleLeads,
      recentLeadsRaw,
      recentActivitiesRaw,
    ] = await Promise.all([
      // 1. Total leads in org
      this.prisma.lead.count({ where: { organizationId } }),

      // 2. Leads created in current timeframe
      this.prisma.lead.count({
        where: { organizationId, createdAt: { gte: start } },
      }),

      // 3. Leads created in previous timeframe for comparison
      this.prisma.lead.count({
        where: {
          organizationId,
          createdAt: { gte: previousStart, lt: start },
        },
      }),

      // 4. Won leads
      this.prisma.lead.count({
        where: {
          organizationId,
          status: {
            name: {
              in: ['Won', 'Customer', 'Closed Won'],
              mode: 'insensitive',
            },
          },
        },
      }),

      // 5. Lost leads
      this.prisma.lead.count({
        where: {
          organizationId,
          status: {
            name: { in: ['Lost', 'Closed Lost'], mode: 'insensitive' },
          },
        },
      }),

      // 6. Total imports
      this.prisma.import.count({ where: { organizationId } }),

      // 7. Prevented duplicates
      this.prisma.import.aggregate({
        where: { organizationId },
        _sum: { duplicateRows: true },
      }),

      // 8. Leads grouped by status
      this.prisma.lead.groupBy({
        by: ['statusId'],
        where: { organizationId },
        _count: { id: true },
      }),

      // 9. All organization statuses
      this.prisma.leadStatus.findMany({
        where: { organizationId },
        orderBy: { order: 'asc' },
      }),

      // 10. Leads grouped by source
      this.prisma.lead.groupBy({
        by: ['sourceName'],
        where: { organizationId },
        _count: { id: true },
      }),

      // 11. Team members in org with lead relations
      this.prisma.user.findMany({
        where: { organizationId, isActive: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          ownedLeads: {
            select: {
              id: true,
              status: { select: { name: true } },
            },
          },
        },
      }),

      // 12. Unassigned leads
      this.prisma.lead.count({
        where: { organizationId, ownerId: null },
      }),

      // 13. Uncontacted leads (status name 'New')
      this.prisma.lead.count({
        where: {
          organizationId,
          status: { name: { equals: 'New', mode: 'insensitive' } },
        },
      }),

      // 14. Stale leads (updated more than 7 days ago and not won/lost)
      this.prisma.lead.findMany({
        where: {
          organizationId,
          updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          status: {
            name: { notIn: ['Won', 'Customer', 'Lost'], mode: 'insensitive' },
          },
        },
        select: { id: true, firstName: true, lastName: true, updatedAt: true },
        take: 5,
      }),

      // 15. Recent leads (latest 5)
      this.prisma.lead.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          status: { select: { name: true, color: true } },
          owner: { select: { firstName: true, lastName: true } },
        },
      }),

      // 16. Recent activities (latest 8)
      this.prisma.leadActivity.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          lead: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
    ]);

    // Trend calculation
    const leadsGrowthRate =
      leadsPreviousPeriod > 0
        ? Math.round(
            ((leadsThisPeriod - leadsPreviousPeriod) / leadsPreviousPeriod) *
              1000,
          ) / 10
        : leadsThisPeriod > 0
          ? 100
          : 0;

    const activeLeads = Math.max(0, totalLeads - wonLeads - lostLeads);
    const conversionRate =
      totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 1000) / 10 : 0;
    const duplicateLeadsPrevented = importStats._sum.duplicateRows || 0;

    // Map pipeline statuses with actual counts
    const statusCountMap = new Map(
      statusGroups.map((g) => [g.statusId, g._count.id]),
    );

    const pipeline = statuses.map((s) => {
      const count = statusCountMap.get(s.id) || 0;
      const percentage =
        totalLeads > 0 ? Math.round((count / totalLeads) * 1000) / 10 : 0;
      return {
        statusId: s.id,
        name: s.name,
        color: s.color,
        order: s.order,
        count,
        percentage,
      };
    });

    // Map sources
    const sources = sourceGroups.map((sg) => {
      const count = sg._count.id;
      const percentage =
        totalLeads > 0 ? Math.round((count / totalLeads) * 1000) / 10 : 0;
      return {
        name: sg.sourceName || 'Direct',
        count,
        percentage,
      };
    });

    // Time-series trends (bucketed by day)
    const trendBuckets = Math.min(days, 30);
    const trendStartDate = new Date();
    trendStartDate.setDate(trendStartDate.getDate() - trendBuckets);
    trendStartDate.setHours(0, 0, 0, 0);

    const periodLeads = await this.prisma.lead.findMany({
      where: {
        organizationId,
        createdAt: { gte: trendStartDate },
      },
      select: { createdAt: true },
    });

    const dateMap: Record<string, number> = {};
    for (let i = 0; i <= trendBuckets; i++) {
      const d = new Date(trendStartDate);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      dateMap[key] = 0;
    }

    for (const l of periodLeads) {
      const key = l.createdAt.toISOString().slice(0, 10);
      if (dateMap[key] !== undefined) {
        dateMap[key]++;
      }
    }

    const trends = Object.entries(dateMap).map(([date, count]) => {
      const d = new Date(date);
      const label = d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      return { date, label, count };
    });

    // Team performance
    const teamPerformance = users
      .map((u) => {
        const assignedCount = u.ownedLeads.length;
        const wonCount = u.ownedLeads.filter(
          (l) =>
            l.status?.name?.toLowerCase() === 'won' ||
            l.status?.name?.toLowerCase() === 'customer',
        ).length;
        const rate =
          assignedCount > 0
            ? Math.round((wonCount / assignedCount) * 1000) / 10
            : 0;
        return {
          userId: u.id,
          name: `${u.firstName} ${u.lastName}`,
          email: u.email,
          assignedCount,
          wonCount,
          conversionRate: rate,
        };
      })
      .sort((a, b) => b.assignedCount - a.assignedCount);

    // Action items
    const actionItemsList: DashboardPayload['actionItems']['items'] = [];
    if (unassignedCount > 0) {
      actionItemsList.push({
        id: 'unassigned',
        title: `${unassignedCount} Unassigned Lead${unassignedCount > 1 ? 's' : ''}`,
        reason: 'Leads without an assigned owner risk cold response latency',
        severity: unassignedCount > 10 ? 'high' : 'medium',
      });
    }
    if (uncontactedCount > 0) {
      actionItemsList.push({
        id: 'uncontacted',
        title: `${uncontactedCount} Uncontacted New Lead${uncontactedCount > 1 ? 's' : ''}`,
        reason: 'Leads currently in New stage awaiting initial sales outreach',
        severity: 'high',
      });
    }
    for (const stale of staleLeads) {
      actionItemsList.push({
        id: `stale-${stale.id}`,
        title: `Stalled Lead: ${stale.firstName} ${stale.lastName}`,
        reason: 'No updates or notes logged in over 7 days',
        severity: 'medium',
        leadId: stale.id,
        leadName: `${stale.firstName} ${stale.lastName}`,
      });
    }

    // Deterministic smart insights
    const insights: DashboardPayload['insights'] = [];
    if (leadsGrowthRate > 0) {
      insights.push({
        id: 'growth',
        type: 'positive',
        text: `Lead acquisition grew by ${leadsGrowthRate}% compared to the prior ${days}-day cycle.`,
      });
    } else if (leadsGrowthRate < 0) {
      insights.push({
        id: 'growth-drop',
        type: 'warning',
        text: `Lead intake dropped by ${Math.abs(leadsGrowthRate)}% in the selected period.`,
      });
    }

    if (conversionRate >= 15) {
      insights.push({
        id: 'win-rate',
        type: 'positive',
        text: `Pipeline win conversion rate is healthy at ${conversionRate}%.`,
      });
    } else if (totalLeads > 10 && conversionRate < 5) {
      insights.push({
        id: 'win-rate-low',
        type: 'warning',
        text: `Win conversion rate is at ${conversionRate}%. Consider reviewing lead qualification criteria.`,
      });
    }

    if (duplicateLeadsPrevented > 0) {
      insights.push({
        id: 'dup-shield',
        type: 'info',
        text: `Streaming ingestion shield prevented ${duplicateLeadsPrevented} duplicate rows from contaminating tenant records.`,
      });
    }

    const recentLeads = recentLeadsRaw.map((l) => ({
      id: l.id,
      firstName: l.firstName,
      lastName: l.lastName,
      email: l.email,
      phone: l.phone,
      statusName: l.status?.name,
      statusColor: l.status?.color,
      sourceName: l.sourceName,
      ownerName: l.owner
        ? `${l.owner.firstName} ${l.owner.lastName}`
        : 'Unassigned',
      createdAt: l.createdAt.toISOString(),
    }));

    const recentActivities = recentActivitiesRaw.map((a) => ({
      id: a.id,
      type: a.type,
      description: a.description,
      createdAt: a.createdAt.toISOString(),
      user: a.user,
      lead: a.lead,
    }));

    return {
      overview: {
        totalLeads,
        activeLeads,
        wonLeads,
        lostLeads,
        conversionRate,
        leadsThisPeriod,
        leadsPreviousPeriod,
        leadsGrowthRate,
        totalImports,
        duplicateLeadsPrevented,
      },
      timeframe,
      pipeline,
      sources,
      trends,
      teamPerformance,
      actionItems: {
        unassignedCount,
        uncontactedCount,
        staleCount: staleLeads.length,
        items: actionItemsList,
      },
      recentLeads,
      recentActivities,
      insights,
    };
  }

  // Preserve previous simple overview methods for backwards compatibility
  async getOverview(organizationId: string) {
    const d = await this.getDashboard(organizationId, '30d');
    return {
      totalLeads: d.overview.totalLeads,
      leadsThisMonth: d.overview.leadsThisPeriod,
      leadsThisWeek: d.overview.leadsThisPeriod,
      totalImports: d.overview.totalImports,
      wonLeads: d.overview.wonLeads,
      conversionRate: d.overview.conversionRate,
      duplicateLeadsPrevented: d.overview.duplicateLeadsPrevented,
    };
  }

  async getStatusDistribution(organizationId: string) {
    const d = await this.getDashboard(organizationId, 'all');
    return d.pipeline;
  }

  async getSourceDistribution(organizationId: string) {
    const d = await this.getDashboard(organizationId, 'all');
    return d.sources;
  }

  async getTimelineTrend(organizationId: string, days = 14) {
    const d = await this.getDashboard(organizationId, `${days}d`);
    return d.trends;
  }
}
