import { Test, TestingModule } from '@nestjs/testing';
import { LeadsService } from './leads.service';
import { PrismaService } from '../database/prisma.service';
import { ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

describe('LeadsService', () => {
  let service: LeadsService;

  const mockOrgId = 'org-123';
  const mockLead = {
    id: 'lead-1',
    organizationId: mockOrgId,
    firstName: 'Donald',
    lastName: 'Hamerton',
    email: 'donaldhamerton@gmail.com',
    phone: '6725136550',
    countryName: 'Canada',
    sourceName: 'S6',
    referrer: null,
    tag1: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrismaService = {
    $transaction: jest.fn(),
    lead: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    team: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    country: {
      findFirst: jest.fn(),
    },
    leadSource: {
      findFirst: jest.fn(),
    },
    leadStatus: {
      findFirst: jest.fn(),
    },
    leadActivity: {
      create: jest.fn(),
      createMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<LeadsService>(LeadsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated leads scoped to organizationId', async () => {
      mockPrismaService.lead.count.mockResolvedValue(1);
      mockPrismaService.lead.findMany.mockResolvedValue([mockLead]);

      const result = await service.findAll(mockOrgId, { page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(10);
      expect(mockPrismaService.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: mockOrgId }),
        }),
      );
    });

    it('should apply my_leads preset filtering by currentUserId', async () => {
      mockPrismaService.lead.count.mockResolvedValue(1);
      mockPrismaService.lead.findMany.mockResolvedValue([mockLead]);

      await service.findAll(mockOrgId, { preset: 'my_leads' }, 'user-456');

      expect(mockPrismaService.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ organizationId: mockOrgId }, { ownerId: 'user-456' }]),
          }),
        }),
      );
    });

    it('should apply overdue preset filtering for incomplete past reminders', async () => {
      mockPrismaService.lead.count.mockResolvedValue(1);
      mockPrismaService.lead.findMany.mockResolvedValue([mockLead]);

      await service.findAll(mockOrgId, { preset: 'overdue' });

      expect(mockPrismaService.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { organizationId: mockOrgId },
              expect.objectContaining({ reminders: expect.anything() }),
            ]),
          }),
        }),
      );
    });

    it('should apply unassigned preset filtering by ownerId null', async () => {
      mockPrismaService.lead.count.mockResolvedValue(1);
      mockPrismaService.lead.findMany.mockResolvedValue([mockLead]);

      await service.findAll(mockOrgId, { preset: 'unassigned' });

      expect(mockPrismaService.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ organizationId: mockOrgId }, { ownerId: null }]),
          }),
        }),
      );
    });

    it('should apply sourceFile filter when provided', async () => {
      mockPrismaService.lead.count.mockResolvedValue(1);
      mockPrismaService.lead.findMany.mockResolvedValue([mockLead]);

      await service.findAll(mockOrgId, { sourceFile: 'leads_october.csv' });

      expect(mockPrismaService.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { organizationId: mockOrgId },
              { sourceFile: { contains: 'leads_october.csv', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });
  });


  describe('create', () => {
    it('should create a lead when no duplicate exists', async () => {
      mockPrismaService.lead.findFirst.mockResolvedValue(null);
      mockPrismaService.lead.create.mockResolvedValue(mockLead);
      mockPrismaService.leadActivity.create.mockResolvedValue({});

      const result = await service.create(mockOrgId, {
        firstName: 'Donald',
        lastName: 'Hamerton',
        email: 'donaldhamerton@gmail.com',
        phone: '6725136550',
      });

      expect(result).toEqual(mockLead);
      expect(mockPrismaService.lead.create).toHaveBeenCalled();
      expect(mockPrismaService.leadActivity.create).toHaveBeenCalled();
    });

    it('should throw ConflictException on duplicate email in organization', async () => {
      mockPrismaService.lead.findFirst.mockResolvedValue(mockLead);

      await expect(
        service.create(mockOrgId, {
          firstName: 'Donald',
          lastName: 'Hamerton',
          email: 'donaldhamerton@gmail.com',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it('should return lead if found in the tenant', async () => {
      mockPrismaService.lead.findFirst.mockResolvedValue(mockLead);

      const result = await service.findById(mockOrgId, 'lead-1');
      expect(result).toEqual(mockLead);
    });

    it('should throw NotFoundException if lead does not belong to tenant', async () => {
      mockPrismaService.lead.findFirst.mockResolvedValue(null);

      await expect(service.findById('other-org', 'lead-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('bulkTag', () => {
    it('should append tag when action is ADD and tag does not exist', async () => {
      mockPrismaService.lead.findMany.mockResolvedValue([
        { id: 'lead-1', tag1: 'VIP' },
      ]);
      mockPrismaService.lead.update.mockResolvedValue({});
      mockPrismaService.leadActivity.createMany.mockResolvedValue({});

      const result = await service.bulkTag(mockOrgId, ['lead-1'], 'Hot Lead', 'ADD');

      expect(result.count).toBe(1);
      expect(mockPrismaService.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { tag1: 'VIP, Hot Lead' },
      });
      expect(mockPrismaService.leadActivity.createMany).toHaveBeenCalled();
    });

    it('should remove tag when action is REMOVE', async () => {
      mockPrismaService.lead.findMany.mockResolvedValue([
        { id: 'lead-1', tag1: 'VIP, Hot Lead' },
      ]);
      mockPrismaService.lead.update.mockResolvedValue({});
      mockPrismaService.leadActivity.createMany.mockResolvedValue({});

      const result = await service.bulkTag(mockOrgId, ['lead-1'], 'VIP', 'REMOVE');

      expect(result.count).toBe(1);
      expect(mockPrismaService.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { tag1: 'Hot Lead' },
      });
    });
  });

  describe('bulkEdit', () => {
    it('should simultaneously update status and owner and record activity logs', async () => {
      mockPrismaService.lead.updateMany.mockResolvedValue({ count: 2 });
      mockPrismaService.leadStatus.findFirst.mockResolvedValue({ id: 'status-won', name: 'Won' });
      mockPrismaService.leadActivity.createMany.mockResolvedValue({});

      const result = await service.bulkEdit(mockOrgId, ['lead-1', 'lead-2'], {
        statusId: 'status-won',
        ownerId: 'user-alex',
      });

      expect(result.count).toBe(2);
      expect(result.updatedFields).toEqual(['status', 'owner']);
      expect(mockPrismaService.lead.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['lead-1', 'lead-2'] },
          organizationId: mockOrgId,
        },
        data: {
          statusId: 'status-won',
          ownerId: 'user-alex',
        },
      });
      expect(mockPrismaService.leadActivity.createMany).toHaveBeenCalled();
    });
  });

  describe('exportLeadsToCsv', () => {
    it('should export leads including Source File column and respect sourceFile filter', async () => {
      const mockLeadWithSource = {
        ...mockLead,
        sourceFile: 'leads_october.csv',
        status: { name: 'New' },
        source: { name: 'Website' },
        country: { name: 'Canada' },
        owner: { firstName: 'Agent', lastName: 'Smith' },
      };
      mockPrismaService.lead.findMany.mockResolvedValue([mockLeadWithSource]);

      const csv = await service.exportLeadsToCsv(mockOrgId, {
        sourceFile: 'leads_october.csv',
      });

      expect(csv).toContain('Source File');
      expect(csv).toContain('leads_october.csv');
      expect(mockPrismaService.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { organizationId: mockOrgId },
              { sourceFile: { contains: 'leads_october.csv', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });
  });

  describe('transferLeads', () => {
    const adminUser = {
      id: 'admin-1',
      organizationId: mockOrgId,
      email: 'admin@crm.com',
      username: 'admin',
      role: Role.ADMIN,
    };

    const managerUser = {
      id: 'manager-1',
      organizationId: mockOrgId,
      email: 'manager@crm.com',
      username: 'manager',
      role: Role.MANAGER,
    };

    const operatorUser = {
      id: 'operator-1',
      organizationId: mockOrgId,
      email: 'operator@crm.com',
      username: 'operator',
      role: Role.OPERATOR,
    };

    it('should allow Admin to transfer leads to any active user in org', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'user-dest',
        firstName: 'Dest',
        lastName: 'User',
        username: 'destuser',
        email: 'dest@crm.com',
        role: Role.OPERATOR,
      });

      mockPrismaService.$transaction.mockImplementation(async (cb) => {
        return cb({
          lead: {
            updateMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
          leadActivity: {
            createMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
          auditLog: {
            create: jest.fn().mockResolvedValue({}),
          },
          notification: {
            create: jest.fn().mockResolvedValue({}),
          },
        });
      });

      const result = await service.transferLeads(
        mockOrgId,
        { leadIds: ['lead-1', 'lead-2'], toUserId: 'user-dest' },
        adminUser as any,
      );

      expect(result.count).toBe(2);
      expect(result.toUser.id).toBe('user-dest');
    });

    it('should allow Manager to transfer leads between members of their assigned team', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'member-dest',
        firstName: 'Team',
        lastName: 'Member',
        username: 'teammember',
        email: 'tm@crm.com',
        role: Role.OPERATOR,
      });

      // Manager's team includes manager-1 and member-dest and member-src
      mockPrismaService.team.findMany.mockResolvedValue([
        {
          id: 'team-1',
          name: 'Alpha Team',
          managerId: 'manager-1',
          members: [
            { userId: 'member-src' },
            { userId: 'member-dest' },
          ],
        },
      ]);

      mockPrismaService.lead.findMany.mockResolvedValue([
        { id: 'lead-1', ownerId: 'member-src' },
      ]);

      mockPrismaService.$transaction.mockImplementation(async (cb) => {
        return cb({
          lead: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          leadActivity: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          auditLog: {
            create: jest.fn().mockResolvedValue({}),
          },
          notification: {
            create: jest.fn().mockResolvedValue({}),
          },
        });
      });

      const result = await service.transferLeads(
        mockOrgId,
        { leadIds: ['lead-1'], toUserId: 'member-dest' },
        managerUser as any,
      );

      expect(result.count).toBe(1);
    });

    it('should reject Manager transfer if destination user is outside assigned team', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'outsider-user',
        firstName: 'Out',
        lastName: 'Sider',
        username: 'outsider',
        role: Role.OPERATOR,
      });

      // Manager's team only includes member-1
      mockPrismaService.team.findMany.mockResolvedValue([
        {
          id: 'team-1',
          name: 'Alpha Team',
          managerId: 'manager-1',
          members: [{ userId: 'member-1' }],
        },
      ]);

      await expect(
        service.transferLeads(
          mockOrgId,
          { leadIds: ['lead-1'], toUserId: 'outsider-user' },
          managerUser as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject Manager transfer if source lead belongs to someone outside assigned team', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'member-1',
        firstName: 'Member',
        lastName: 'One',
        username: 'member1',
        role: Role.OPERATOR,
      });

      mockPrismaService.team.findMany.mockResolvedValue([
        {
          id: 'team-1',
          name: 'Alpha Team',
          managerId: 'manager-1',
          members: [{ userId: 'member-1' }],
        },
      ]);

      // Lead is owned by an outsider
      mockPrismaService.lead.findMany.mockResolvedValue([
        { id: 'lead-1', ownerId: 'other-team-user' },
      ]);

      await expect(
        service.transferLeads(
          mockOrgId,
          { leadIds: ['lead-1'], toUserId: 'member-1' },
          managerUser as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject transfer when actor is an Operator', async () => {
      await expect(
        service.transferLeads(
          mockOrgId,
          { leadIds: ['lead-1'], toUserId: 'any-user' },
          operatorUser as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getEligibleTransferUsers', () => {
    it('should return all organization users and unassigned count for Admin', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([
        {
          id: 'u-1',
          username: 'user1',
          email: 'u1@crm.com',
          firstName: 'User',
          lastName: 'One',
          role: Role.OPERATOR,
          _count: { ownedLeads: 5 },
        },
      ]);
      mockPrismaService.lead.count.mockResolvedValue(12);

      const result = await service.getEligibleTransferUsers(mockOrgId, {
        id: 'admin-1',
        role: Role.ADMIN,
      } as any);

      expect(result.scope).toBe('admin');
      expect(result.users).toHaveLength(1);
      expect(result.unassignedCount).toBe(12);
    });

    it('should return only team members for Manager', async () => {
      mockPrismaService.team.findMany.mockResolvedValue([
        {
          name: 'Team Bravo',
          manager: {
            id: 'mgr-1',
            username: 'mgr1',
            email: 'mgr1@crm.com',
            firstName: 'Boss',
            lastName: 'Man',
            role: Role.MANAGER,
            _count: { ownedLeads: 1 },
          },
          members: [
            {
              user: {
                id: 'op-1',
                username: 'op1',
                email: 'op1@crm.com',
                firstName: 'Oper',
                lastName: 'Ator',
                role: Role.OPERATOR,
                isActive: true,
                _count: { ownedLeads: 8 },
              },
            },
          ],
        },
      ]);

      const result = await service.getEligibleTransferUsers(mockOrgId, {
        id: 'mgr-1',
        role: Role.MANAGER,
      } as any);

      expect(result.scope).toBe('manager');
      expect(result.users).toHaveLength(2);
      expect(result.unassignedCount).toBe(0);
    });
  });
});
