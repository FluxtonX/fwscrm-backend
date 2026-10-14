import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TeamsService } from './teams.service';
import { PrismaService } from '../database/prisma.service';

describe('TeamsService', () => {
  let service: TeamsService;
  let prisma: PrismaService;

  const mockOrgId = 'org-123';
  const mockActorId = 'actor-456';
  const mockTeamId = 'team-789';

  const mockPrisma = {
    team: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    teamMember: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<TeamsService>(TeamsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('createTeam', () => {
    it('should successfully create a team without manager', async () => {
      mockPrisma.team.findUnique.mockResolvedValue(null);
      const createdTeam = {
        id: mockTeamId,
        organizationId: mockOrgId,
        name: 'Alpha Team',
        description: 'Alpha sales team',
        managerId: null,
      };
      mockPrisma.team.create.mockResolvedValue(createdTeam);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.createTeam(mockOrgId, mockActorId, {
        name: 'Alpha Team',
        description: 'Alpha sales team',
      });

      expect(result).toEqual(createdTeam);
      expect(mockPrisma.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Alpha Team',
            organizationId: mockOrgId,
          }),
        }),
      );
    });

    it('should throw ConflictException if team name already exists', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(
        service.createTeam(mockOrgId, mockActorId, { name: 'Alpha Team' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if assigned manager does not exist or is inactive', async () => {
      mockPrisma.team.findUnique.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.createTeam(mockOrgId, mockActorId, {
          name: 'Alpha Team',
          managerId: 'invalid-manager',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listTeams', () => {
    it('should list all teams for Super Admin', async () => {
      mockPrisma.team.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);

      const result = await service.listTeams(mockOrgId, mockActorId, Role.SUPER_ADMIN);

      expect(result).toHaveLength(2);
      expect(mockPrisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: mockOrgId },
        }),
      );
    });

    it('should filter teams for Manager role', async () => {
      mockPrisma.team.findMany.mockResolvedValue([{ id: 't1' }]);

      const result = await service.listTeams(mockOrgId, mockActorId, Role.MANAGER);

      expect(result).toHaveLength(1);
      expect(mockPrisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: mockOrgId,
            OR: expect.any(Array),
          }),
        }),
      );
    });
  });

  describe('getTeamById', () => {
    it('should return team if found', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({ id: mockTeamId });

      const result = await service.getTeamById(mockOrgId, mockTeamId);
      expect(result).toEqual({ id: mockTeamId });
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(null);

      await expect(service.getTeamById(mockOrgId, mockTeamId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('addMember', () => {
    it('should successfully add a member to the team', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({ id: mockTeamId, name: 'Alpha Team' });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1', email: 'op@crm.local' });
      mockPrisma.teamMember.findUnique.mockResolvedValue(null);
      mockPrisma.teamMember.create.mockResolvedValue({ id: 'tm-1', teamId: mockTeamId, userId: 'user-1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.addMember(mockOrgId, mockTeamId, mockActorId, {
        userId: 'user-1',
      });

      expect(result).toBeDefined();
      expect(mockPrisma.teamMember.create).toHaveBeenCalled();
    });

    it('should throw ConflictException if user is already a member', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({ id: mockTeamId });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
      mockPrisma.teamMember.findUnique.mockResolvedValue({ id: 'existing-tm' });

      await expect(
        service.addMember(mockOrgId, mockTeamId, mockActorId, { userId: 'user-1' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeMember', () => {
    it('should remove member from team', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({ id: mockTeamId, name: 'Alpha Team' });
      mockPrisma.teamMember.findUnique.mockResolvedValue({ id: 'tm-1' });
      mockPrisma.teamMember.delete.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.removeMember(mockOrgId, mockTeamId, 'user-1', mockActorId);
      expect(result.success).toBe(true);
      expect(mockPrisma.teamMember.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user is not a member', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({ id: mockTeamId, name: 'Alpha' });
      mockPrisma.teamMember.findUnique.mockResolvedValue(null);

      await expect(
        service.removeMember(mockOrgId, mockTeamId, 'user-1', mockActorId),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
