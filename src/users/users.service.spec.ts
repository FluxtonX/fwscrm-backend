import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../database/prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

describe('UsersService', () => {
  let service: UsersService;

  const mockOrgId = 'org-123';
  const mockUser = {
    id: 'user-1',
    organizationId: mockOrgId,
    email: 'agent@fwscrm.com',
    passwordHash: 'hashed_pw',
    firstName: 'Jane',
    lastName: 'Doe',
    role: Role.AGENT,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrismaService: any = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create user when email does not exist in org', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(mockUser);

      const result = await service.create({
        organizationId: mockOrgId,
        email: 'agent@fwscrm.com',
        passwordHash: 'hashed_pw',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      expect(result).toEqual(mockUser);
      expect(mockPrismaService.user.create).toHaveBeenCalled();
    });

    it('should throw ConflictException on duplicate email in org', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.create({
          organizationId: mockOrgId,
          email: 'agent@fwscrm.com',
          passwordHash: 'hashed_pw',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it('should return user if found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findById('user-1');
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listByOrganization', () => {
    it('should return users for the organization', async () => {
      const mockList = [
        {
          id: 'user-1',
          organizationId: mockOrgId,
          email: 'agent@fwscrm.com',
          firstName: 'Jane',
          lastName: 'Doe',
          role: Role.AGENT,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockPrismaService.user.findMany.mockResolvedValue(mockList);

      const result = await service.listByOrganization(mockOrgId);
      expect(result).toEqual(mockList);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: mockOrgId },
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('updateRole', () => {
    it('should update role and create audit log', async () => {
      mockPrismaService.user.findFirst = jest.fn().mockResolvedValue({
        id: 'user-2',
        organizationId: mockOrgId,
        role: Role.OPERATOR,
        email: 'operator@example.com',
      });
      mockPrismaService.user.update = jest.fn().mockResolvedValue({
        id: 'user-2',
        role: Role.MANAGER,
      });
      mockPrismaService.auditLog = {
        create: jest.fn().mockResolvedValue({}),
      };

      const result = await service.updateRole(
        mockOrgId,
        'user-2',
        Role.MANAGER,
        'admin-id',
      );

      expect(result.role).toBe(Role.MANAGER);
      expect(mockPrismaService.auditLog.create).toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('should update status and prevent self-deactivation', async () => {
      mockPrismaService.user.findFirst = jest.fn().mockResolvedValue({
        id: 'admin-id',
        organizationId: mockOrgId,
        role: Role.SUPER_ADMIN,
        email: 'admin@example.com',
      });

      await expect(
        service.updateStatus(mockOrgId, 'admin-id', false, 'admin-id'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
