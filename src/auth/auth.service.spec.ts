import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import {
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;

  const mockOrg = {
    id: 'org-1',
    name: 'Acme Corp',
    slug: 'acme',
  };

  const mockUser = {
    id: 'user-1',
    organizationId: mockOrg.id,
    email: 'admin@acme.com',
    passwordHash: 'hashed_password',
    firstName: 'Alice',
    lastName: 'Admin',
    role: Role.SUPER_ADMIN,
    isActive: true,
    organization: mockOrg,
  };

  const mockPrismaService = {
    organization: {
      findUnique: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock.jwt.token'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should register a new organization and super admin successfully', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback({
          organization: { create: jest.fn().mockResolvedValue(mockOrg) },
          user: { create: jest.fn().mockResolvedValue(mockUser) },
          leadStatus: { create: jest.fn().mockResolvedValue({}) },
          leadSource: { create: jest.fn().mockResolvedValue({}) },
        });
      });

      const result = await service.register({
        organizationName: 'Acme Corp',
        organizationSlug: 'acme',
        email: 'admin@acme.com',
        password: 'securePassword123!',
        firstName: 'Alice',
        lastName: 'Admin',
      });

      expect(result.user.email).toBe('admin@acme.com');
      expect(result.organization.slug).toBe('acme');
      expect(result.token).toBe('mock.jwt.token');
    });

    it('should throw ConflictException if organization slug already exists', async () => {
      mockPrismaService.organization.findUnique.mockResolvedValue(mockOrg);

      await expect(
        service.register({
          organizationName: 'Acme Corp',
          organizationSlug: 'acme',
          email: 'admin@acme.com',
          password: 'securePassword123!',
          firstName: 'Alice',
          lastName: 'Admin',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return user and token when credentials are valid', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        email: 'admin@acme.com',
        password: 'correctPassword',
      });

      expect(result.user.email).toBe('admin@acme.com');
      expect(result.token).toBe('mock.jwt.token');
    });

    it('should throw UnauthorizedException when password does not match', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({
          email: 'admin@acme.com',
          password: 'wrongPassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(
        service.login({
          email: 'unknown@acme.com',
          password: 'anyPassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user account is deactivated', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      await expect(
        service.login({
          email: 'admin@acme.com',
          password: 'correctPassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('resetPassword', () => {
    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          email: 'nonexistent@acme.com',
          newPassword: 'newValidPassword123',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update password hash and return success', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new_hashed_pwd');
      mockPrismaService.user.update.mockResolvedValue({
        ...mockUser,
        passwordHash: 'new_hashed_pwd',
      });

      const result = await service.resetPassword({
        email: 'admin@acme.com',
        newPassword: 'newValidPassword123',
      });

      expect(result.success).toBe(true);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { passwordHash: 'new_hashed_pwd' },
      });
    });
  });
});
