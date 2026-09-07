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

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
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
    it('should return active users for the organization', async () => {
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
        where: { organizationId: mockOrgId, isActive: true },
        select: expect.any(Object),
        orderBy: { lastName: 'asc' },
      });
    });
  });
});
