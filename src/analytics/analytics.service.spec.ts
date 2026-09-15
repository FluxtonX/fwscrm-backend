import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../database/prisma.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  const mockPrisma = {
    lead: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    leadStatus: {
      findMany: jest.fn(),
    },
    leadActivity: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    import: {
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    leadReminder: {
      count: jest.fn().mockResolvedValue(0),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDashboard', () => {
    it('should aggregate metrics and return full command center dashboard payload', async () => {
      // 1. Total leads (100)
      // 2. Leads this period (25)
      // 3. Leads prev period (20)
      // 4. Won leads (15)
      // 5. Lost leads (5)
      // 12. Unassigned leads (10)
      // 13. Uncontacted leads (8)
      mockPrisma.lead.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(25)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8);

      mockPrisma.import.count.mockResolvedValue(4);
      mockPrisma.import.aggregate.mockResolvedValue({
        _sum: { duplicateRows: 12 },
      });

      // Status groups
      mockPrisma.lead.groupBy
        .mockResolvedValueOnce([{ statusId: 's1', _count: { id: 40 } }]) // statusGroups
        .mockResolvedValueOnce([
          { sourceName: 'Google Ads', _count: { id: 35 } },
        ]); // sourceGroups

      mockPrisma.leadStatus.findMany.mockResolvedValue([
        { id: 's1', name: 'Qualified', color: '#0D9488', order: 1 },
      ]);

      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          firstName: 'Sarah',
          lastName: 'Sales',
          email: 'sarah@fwscrm.com',
          ownedLeads: [{ id: 'l1', status: { name: 'Won' } }],
        },
      ]);

      mockPrisma.lead.findMany
        .mockResolvedValueOnce([]) // staleLeads
        .mockResolvedValueOnce([
          {
            id: 'l1',
            firstName: 'Donald',
            lastName: 'Draper',
            email: 'don@sterling.com',
            phone: '555-1234',
            createdAt: new Date(),
            status: { name: 'Qualified', color: '#0D9488' },
            owner: { firstName: 'Sarah', lastName: 'Sales' },
          },
        ]) // recentLeadsRaw
        .mockResolvedValueOnce([]); // periodLeads for trends

      mockPrisma.leadActivity.findMany.mockResolvedValue([
        {
          id: 'act-1',
          type: 'STATUS_CHANGED',
          description: 'Lead status updated to Qualified',
          createdAt: new Date(),
          user: {
            id: 'u1',
            firstName: 'Sarah',
            lastName: 'Sales',
            email: 'sarah@fwscrm.com',
          },
          lead: {
            id: 'l1',
            firstName: 'Donald',
            lastName: 'Draper',
            email: 'don@sterling.com',
          },
        },
      ]);

      const dashboard = await service.getDashboard('org-1', '30d');

      expect(dashboard).toBeDefined();
      expect(dashboard.overview.totalLeads).toBe(100);
      expect(dashboard.overview.wonLeads).toBe(15);
      expect(dashboard.overview.conversionRate).toBe(15);
      expect(dashboard.overview.duplicateLeadsPrevented).toBe(12);
      expect(dashboard.pipeline).toHaveLength(1);
      expect(dashboard.pipeline[0].name).toBe('Qualified');
      expect(dashboard.sources).toHaveLength(1);
      expect(dashboard.sources[0].name).toBe('Google Ads');
      expect(dashboard.teamPerformance).toHaveLength(1);
      expect(dashboard.teamPerformance[0].name).toBe('Sarah Sales');
      expect(dashboard.recentLeads).toHaveLength(1);
      expect(dashboard.recentActivities).toHaveLength(1);
      expect(dashboard.actionItems.unassignedCount).toBe(10);
      expect(dashboard.actionItems.uncontactedCount).toBe(8);
      expect(dashboard.insights.length).toBeGreaterThan(0);
    });
  });

  describe('getOverview', () => {
    it('should return overview metrics for backwards compatibility', async () => {
      mockPrisma.lead.count
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      mockPrisma.import.count.mockResolvedValue(2);
      mockPrisma.import.aggregate.mockResolvedValue({
        _sum: { duplicateRows: 4 },
      });

      mockPrisma.lead.groupBy.mockResolvedValue([]);
      mockPrisma.leadStatus.findMany.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.lead.findMany.mockResolvedValue([]);
      mockPrisma.leadActivity.findMany.mockResolvedValue([]);

      const overview = await service.getOverview('org-1');

      expect(overview.totalLeads).toBe(50);
      expect(overview.wonLeads).toBe(10);
      expect(overview.conversionRate).toBe(20);
      expect(overview.duplicateLeadsPrevented).toBe(4);
    });
  });
});
