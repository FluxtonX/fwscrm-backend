import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../database/prisma.service';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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

  describe('createMember', () => {
    it('should create member with MANAGER role, hashed password, and audit log', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-manager-1',
        organizationId: mockOrgId,
        email: 'manager@fwscrm.com',
        firstName: 'Manager',
        lastName: 'One',
        role: Role.MANAGER,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.createMember(mockOrgId, 'admin-1', {
        email: 'manager@fwscrm.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        role: Role.MANAGER,
        firstName: 'Manager',
        lastName: 'One',
      });

      expect(result.role).toBe(Role.MANAGER);
      expect(result.email).toBe('manager@fwscrm.com');
      expect(mockPrismaService.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: mockOrgId,
            email: 'manager@fwscrm.com',
            role: Role.MANAGER,
            isActive: true,
          }),
        }),
      );
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'user.created',
            targetType: 'user',
          }),
        }),
      );
    });

    it('should throw BadRequestException if passwords do not match', async () => {
      await expect(
        service.createMember(mockOrgId, 'admin-1', {
          email: 'op@fwscrm.com',
          password: 'Password123!',
          confirmPassword: 'DifferentPassword!',
          role: Role.OPERATOR,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if role is not MANAGER or OPERATOR', async () => {
      await expect(
        service.createMember(mockOrgId, 'admin-1', {
          email: 'sa@fwscrm.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          role: Role.SUPER_ADMIN,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createMember(mockOrgId, 'admin-1', {
          email: 'admin@fwscrm.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          role: Role.ADMIN,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should never expose or return passwordHash in result', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-manager-secure',
        organizationId: mockOrgId,
        email: 'secure@fwscrm.com',
        firstName: 'Secure',
        lastName: 'Member',
        role: Role.MANAGER,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.createMember(mockOrgId, 'admin-1', {
        email: 'secure@fwscrm.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        role: Role.MANAGER,
      });

      expect((result as any).passwordHash).toBeUndefined();
      expect((result as any).password).toBeUndefined();
    });

    it('should throw ConflictException on duplicate email in org', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.createMember(mockOrgId, 'admin-1', {
          email: 'agent@fwscrm.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          role: Role.OPERATOR,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should derive firstName from email prefix when firstName is omitted', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: 'user-op-1',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.createMember(mockOrgId, 'admin-1', {
        email: 'john.smith@fwscrm.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        role: Role.OPERATOR,
      });

      expect(mockPrismaService.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstName: 'john.smith',
            lastName: '',
          }),
        }),
      );
    });
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
