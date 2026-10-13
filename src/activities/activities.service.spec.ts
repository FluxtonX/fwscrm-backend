import { Test, TestingModule } from '@nestjs/testing';
import { ActivitiesService } from './activities.service';
import { PrismaService } from '../database/prisma.service';
import { ActivityType, Role } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';

describe('ActivitiesService', () => {
  let service: ActivitiesService;

  const mockPrisma = {
    lead: {
      findFirst: jest.fn(),
    },
    leadActivity: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getLeadActivities', () => {
    it('should throw NotFoundException if lead does not belong to organization', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.getLeadActivities('org-1', 'lead-404', Role.OPERATOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('should filter out administrative activity types when role is OPERATOR', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', organizationId: 'org-1' });
      mockPrisma.leadActivity.findMany.mockResolvedValueOnce([]);

      await service.getLeadActivities('org-1', 'lead-1', Role.OPERATOR);

      expect(mockPrisma.leadActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            leadId: 'lead-1',
            type: {
              in: [
                ActivityType.CREATED,
                ActivityType.STATUS_CHANGED,
                ActivityType.NOTE_ADDED,
                ActivityType.UPDATED,
              ],
            },
          },
        }),
      );
    });

    it('should NOT filter activity types when role is MANAGER', async () => {
      mockPrisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', organizationId: 'org-1' });
      mockPrisma.leadActivity.findMany.mockResolvedValueOnce([]);

      await service.getLeadActivities('org-1', 'lead-1', Role.MANAGER);

      expect(mockPrisma.leadActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            leadId: 'lead-1',
          },
        }),
      );
    });
  });

  describe('getOrganizationActivities', () => {
    it('should filter out administrative activity types for OPERATOR', async () => {
      mockPrisma.leadActivity.findMany.mockResolvedValueOnce([]);

      await service.getOrganizationActivities('org-1', 10, Role.OPERATOR);

      expect(mockPrisma.leadActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            type: {
              in: [
                ActivityType.CREATED,
                ActivityType.STATUS_CHANGED,
                ActivityType.NOTE_ADDED,
                ActivityType.UPDATED,
              ],
            },
          },
        }),
      );
    });

    it('should NOT filter activity types for ADMIN or MANAGER', async () => {
      mockPrisma.leadActivity.findMany.mockResolvedValueOnce([]);

      await service.getOrganizationActivities('org-1', 10, Role.ADMIN);

      expect(mockPrisma.leadActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
          },
        }),
      );
    });
  });
});
