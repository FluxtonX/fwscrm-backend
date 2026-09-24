import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../database/prisma.service';
import { Role } from '@prisma/client';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('test-secret'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(
      mockConfigService as unknown as ConfigService,
      mockPrismaService as unknown as PrismaService,
    );
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    const validUser = {
      id: 'user-1',
      email: 'user@example.com',
      organizationId: 'org-1',
      role: Role.MANAGER,
      firstName: 'John',
      lastName: 'Doe',
      isActive: true,
      accessExpiresAt: null,
    };

    it('should return user payload when user is active and has no expiration', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(validUser);

      const result = await strategy.validate({
        sub: 'user-1',
        email: 'user@example.com',
        role: Role.MANAGER,
        organizationId: 'org-1',
      });

      expect(result).toEqual({
        id: 'user-1',
        email: 'user@example.com',
        organizationId: 'org-1',
        role: Role.MANAGER,
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        strategy.validate({
          sub: 'unknown',
          email: 'unknown@example.com',
          role: Role.MANAGER,
          organizationId: 'org-1',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user is inactive', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...validUser,
        isActive: false,
      });

      await expect(
        strategy.validate({
          sub: 'user-1',
          email: 'user@example.com',
          role: Role.MANAGER,
          organizationId: 'org-1',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException("Access denied.") when temporary access has expired mid-session', async () => {
      const pastDate = new Date(Date.now() - 1000 * 60);
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...validUser,
        accessExpiresAt: pastDate,
      });

      await expect(
        strategy.validate({
          sub: 'user-1',
          email: 'user@example.com',
          role: Role.MANAGER,
          organizationId: 'org-1',
        }),
      ).rejects.toThrow(new UnauthorizedException('Access denied.'));
    });

    it('should succeed when temporary access expiration is still in the future', async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60);
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...validUser,
        accessExpiresAt: futureDate,
      });

      const result = await strategy.validate({
        sub: 'user-1',
        email: 'user@example.com',
        role: Role.MANAGER,
        organizationId: 'org-1',
      });

      expect(result.id).toBe('user-1');
    });

    it('should allow SUPER_ADMIN even if accessExpiresAt is in past', async () => {
      const pastDate = new Date(Date.now() - 1000 * 60);
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...validUser,
        role: Role.SUPER_ADMIN,
        accessExpiresAt: pastDate,
      });

      const result = await strategy.validate({
        sub: 'user-1',
        email: 'user@example.com',
        role: Role.SUPER_ADMIN,
        organizationId: 'org-1',
      });

      expect(result.role).toBe(Role.SUPER_ADMIN);
    });
  });
});
