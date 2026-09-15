import { Test, TestingModule } from '@nestjs/testing';
import { LeadsService } from './leads.service';
import { PrismaService } from '../database/prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

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
    country: {
      findFirst: jest.fn(),
    },
    leadSource: {
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
});
