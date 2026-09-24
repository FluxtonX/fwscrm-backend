import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RolesGuard } from './guards/roles.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { Reflector } from '@nestjs/core';
import { Role, AccessType } from '@prisma/client';
import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('Phase 4: IP-Based Control & Access Expiration Complete QA E2E Suite', () => {
  jest.setTimeout(30000);
  let authController: AuthController;
  let authService: AuthService;
  let usersController: UsersController;
  let usersService: UsersService;
  let jwtStrategy: JwtStrategy;
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  const orgA = {
    id: 'org-tenant-a',
    name: 'Org A Corp',
    slug: 'org-a',
  };

  const orgB = {
    id: 'org-tenant-b',
    name: 'Org B Corp',
    slug: 'org-b',
  };

  const superAdminCaller = {
    id: 'sa-1',
    organizationId: orgA.id,
    email: 'superadmin@org-a.com',
    role: Role.SUPER_ADMIN,
  };

  const managerCaller = {
    id: 'mgr-caller-1',
    organizationId: orgA.id,
    email: 'manager.caller@org-a.com',
    role: Role.MANAGER,
  };

  let inMemoryUsers: any[] = [];
  let inMemoryAuditLogs: any[] = [];

  const mockPrismaService = {
    organization: {
      findUnique: jest.fn(({ where }: any) => {
        if (where.id === orgA.id) return Promise.resolve(orgA);
        if (where.id === orgB.id) return Promise.resolve(orgB);
        return Promise.resolve(null);
      }),
    },
    user: {
      findFirst: jest.fn(({ where }: any) => {
        const rawEmail = typeof where.email === 'string' ? where.email : where.email?.equals;
        const email = rawEmail?.toLowerCase();
        const found = inMemoryUsers.find(
          (u) =>
            u.email.toLowerCase() === email &&
            (!where.organizationId || u.organizationId === where.organizationId),
        );
        if (found) {
          return Promise.resolve({
            ...found,
            organization: found.organizationId === orgA.id ? orgA : orgB,
          });
        }
        return Promise.resolve(null);
      }),
      findUnique: jest.fn(({ where, select }: any) => {
        let found = null;
        if (where.id) {
          found = inMemoryUsers.find((u) => u.id === where.id);
        } else if (where.organizationId_email) {
          found = inMemoryUsers.find(
            (u) =>
              u.organizationId === where.organizationId_email.organizationId &&
              u.email.toLowerCase() === where.organizationId_email.email.toLowerCase(),
          );
        }
        if (!found) return Promise.resolve(null);
        if (select) {
          const projected: any = {};
          for (const k of Object.keys(select)) {
            if (select[k]) projected[k] = found[k];
          }
          return Promise.resolve(projected);
        }
        return Promise.resolve({
          ...found,
          organization: found.organizationId === orgA.id ? orgA : orgB,
        });
      }),
      create: jest.fn(({ data, select }: any) => {
        const record = {
          id: `usr-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        inMemoryUsers.push(record);
        if (select) {
          const filtered: any = {};
          for (const key of Object.keys(select)) {
            if (select[key]) filtered[key] = record[key];
          }
          return Promise.resolve(filtered);
        }
        return Promise.resolve(record);
      }),
      update: jest.fn(({ where, data }: any) => {
        const idx = inMemoryUsers.findIndex((u) => u.id === where.id);
        if (idx !== -1) {
          inMemoryUsers[idx] = { ...inMemoryUsers[idx], ...data, updatedAt: new Date() };
          return Promise.resolve(inMemoryUsers[idx]);
        }
        return Promise.resolve(null);
      }),
    },
    auditLog: {
      create: jest.fn(({ data }: any) => {
        const log = { id: `log-${Date.now()}`, ...data, createdAt: new Date() };
        inMemoryAuditLogs.push(log);
        return Promise.resolve(log);
      }),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-jwt-secret-xyz';
      if (key === 'JWT_EXPIRES_IN') return '7d';
      return null;
    }),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock.jwt.signed.token'),
  };

  beforeEach(async () => {
    inMemoryUsers = [];
    inMemoryAuditLogs = [];
    jest.clearAllMocks();

    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController, UsersController],
      providers: [
        AuthService,
        UsersService,
        JwtStrategy,
        RolesGuard,
        PermissionsGuard,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: Reflector, useValue: reflector },
      ],
    }).compile();

    authController = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
    usersController = module.get<UsersController>(UsersController);
    usersService = module.get<UsersService>(UsersService);
    jwtStrategy = module.get<JwtStrategy>(JwtStrategy);
  });

  const checkRolesGuard = (user: any): boolean => {
    const context = {
      getHandler: () => usersController.createMember,
      getClass: () => UsersController,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as any;
    return rolesGuard.canActivate(context);
  };

  describe('Scenario 1: Super Admin RBAC & Member Creation Restrictions', () => {
    it('should allow Super Admin to create member, and forbid Manager/Operator', () => {
      expect(checkRolesGuard(superAdminCaller)).toBe(true);
      expect(() => checkRolesGuard(managerCaller)).toThrow(ForbiddenException);
      expect(() =>
        checkRolesGuard({ ...managerCaller, role: Role.OPERATOR }),
      ).toThrow(ForbiddenException);
    });

    it('should reject invalid IP format when creating member', async () => {
      await expect(
        usersController.createMember(superAdminCaller as any, {
          email: 'invalid.ip@org-a.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          role: Role.MANAGER,
          allowedIp: '999.999.999.999',
          accessType: AccessType.PERMANENT,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject TEMPORARY access without expiresAt', async () => {
      await expect(
        usersController.createMember(superAdminCaller as any, {
          email: 'no.expiry@org-a.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          role: Role.OPERATOR,
          allowedIp: '203.0.113.25',
          accessType: AccessType.TEMPORARY,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject TEMPORARY access with past expiresAt', async () => {
      const past = new Date(Date.now() - 3600 * 1000).toISOString();
      await expect(
        usersController.createMember(superAdminCaller as any, {
          email: 'past.expiry@org-a.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          role: Role.OPERATOR,
          allowedIp: '203.0.113.25',
          accessType: AccessType.TEMPORARY,
          accessExpiresAt: past,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Scenario 2: Manager with PERMANENT Access and IP Restriction', () => {
    const password = 'ManagerPass123!';
    let createdManager: any;
    const mockRes = { cookie: jest.fn(), clearCookie: jest.fn() } as any;

    beforeEach(async () => {
      createdManager = await usersController.createMember(superAdminCaller as any, {
        email: 'manager.perm@org-a.com',
        password,
        confirmPassword: password,
        role: Role.MANAGER,
        allowedIp: '203.0.113.25',
        accessType: AccessType.PERMANENT,
      });
    });

    it('should store normalized IP and null expiration in database', () => {
      const stored = inMemoryUsers.find((u) => u.email === 'manager.perm@org-a.com');
      expect(stored).toBeDefined();
      expect(stored.allowedIp).toBe('203.0.113.25');
      expect(stored.accessType).toBe(AccessType.PERMANENT);
      expect(stored.accessExpiresAt).toBeNull();
    });

    it('should allow login from the configured IP (203.0.113.25)', async () => {
      const mockReq = { ip: '203.0.113.25' } as any;
      const res = await authController.login(
        { email: 'manager.perm@org-a.com', password },
        mockReq,
        mockRes,
      );

      expect(res.user.email).toBe('manager.perm@org-a.com');
      expect(mockRes.cookie).toHaveBeenCalled();
    });

    it('should reject login from an incorrect IP (198.51.100.10) with 401 Unauthorized', async () => {
      const mockReq = { ip: '198.51.100.10' } as any;
      await expect(
        authController.login(
          { email: 'manager.perm@org-a.com', password },
          mockReq,
          mockRes,
        ),
      ).rejects.toThrow(new UnauthorizedException('Access denied.'));
    });

    it('should reject login if IP header is absent/undefined when allowedIp is set', async () => {
      const mockReq = { ip: undefined } as any;
      await expect(
        authController.login(
          { email: 'manager.perm@org-a.com', password },
          mockReq,
          mockRes,
        ),
      ).rejects.toThrow(new UnauthorizedException('Access denied.'));
    });
  });

  describe('Scenario 3: Operator with TEMPORARY Access and Expiration', () => {
    const password = 'OperatorPass123!';
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000); // +24 hours
    let createdOperator: any;
    const mockRes = { cookie: jest.fn(), clearCookie: jest.fn() } as any;

    beforeEach(async () => {
      createdOperator = await usersController.createMember(superAdminCaller as any, {
        email: 'operator.temp@org-a.com',
        password,
        confirmPassword: password,
        role: Role.OPERATOR,
        allowedIp: '203.0.113.25',
        accessType: AccessType.TEMPORARY,
        accessExpiresAt: futureDate.toISOString(),
      });
    });

    it('should allow login from matching IP before expiration', async () => {
      const mockReq = { ip: '203.0.113.25' } as any;
      const res = await authController.login(
        { email: 'operator.temp@org-a.com', password },
        mockReq,
        mockRes,
      );

      expect(res.user.email).toBe('operator.temp@org-a.com');
      expect(mockRes.cookie).toHaveBeenCalled();
    });

    it('should deny login from mismatched IP even before expiration', async () => {
      const mockReq = { ip: '198.51.100.10' } as any;
      await expect(
        authController.login(
          { email: 'operator.temp@org-a.com', password },
          mockReq,
          mockRes,
        ),
      ).rejects.toThrow(new UnauthorizedException('Access denied.'));
    });

    it('should deny login from matching IP once access expiration has passed', async () => {
      // Simulate expiration passing
      const stored = inMemoryUsers.find((u) => u.email === 'operator.temp@org-a.com');
      stored.accessExpiresAt = new Date(Date.now() - 1000); // 1 sec in past

      const mockReq = { ip: '203.0.113.25' } as any;
      await expect(
        authController.login(
          { email: 'operator.temp@org-a.com', password },
          mockReq,
          mockRes,
        ),
      ).rejects.toThrow(new UnauthorizedException('Access denied.'));
    });

    it('should immediately terminate mid-session on authenticated requests via JwtStrategy after expiration', async () => {
      const stored = inMemoryUsers.find((u) => u.email === 'operator.temp@org-a.com');

      // 1. While still valid:
      stored.accessExpiresAt = new Date(Date.now() + 60000);
      const validSession = await jwtStrategy.validate({
        sub: stored.id,
        email: stored.email,
        role: stored.role,
        organizationId: stored.organizationId,
      });
      expect(validSession.id).toBe(stored.id);

      // 2. Access expires mid-session:
      stored.accessExpiresAt = new Date(Date.now() - 5000);
      await expect(
        jwtStrategy.validate({
          sub: stored.id,
          email: stored.email,
          role: stored.role,
          organizationId: stored.organizationId,
        }),
      ).rejects.toThrow(new UnauthorizedException('Access denied.'));
    });
  });

  describe('Scenario 4: Super Admin Immunity & Existing Users Compatibility', () => {
    const mockRes = { cookie: jest.fn(), clearCookie: jest.fn() } as any;

    it('should allow Super Admin login from ANY IP, ignoring any IP or expiration rules', async () => {
      const password = 'SuperAdminPass123!';
      const hash = await bcrypt.hash(password, 10);
      inMemoryUsers.push({
        id: 'sa-imm-1',
        email: 'boss@org-a.com',
        passwordHash: hash,
        role: Role.SUPER_ADMIN,
        isActive: true,
        allowedIp: '10.0.0.1', // Restricted to private IP
        accessExpiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        organizationId: orgA.id,
      });

      const mockReq = { ip: '203.0.113.99' } as any; // Completely different public IP
      const res = await authController.login(
        { email: 'boss@org-a.com', password },
        mockReq,
        mockRes,
      );

      expect(res.user.email).toBe('boss@org-a.com');
      expect(mockRes.cookie).toHaveBeenCalled();
    });

    it('should allow existing users without IP restrictions (null allowedIp) to login from any IP', async () => {
      const password = 'ExistingUserPass123!';
      const hash = await bcrypt.hash(password, 10);
      inMemoryUsers.push({
        id: 'existing-usr-1',
        email: 'legacy.manager@org-a.com',
        passwordHash: hash,
        role: Role.MANAGER,
        isActive: true,
        allowedIp: null,
        accessType: AccessType.PERMANENT,
        accessExpiresAt: null,
        organizationId: orgA.id,
      });

      const mockReq1 = { ip: '1.2.3.4' } as any;
      const res1 = await authController.login(
        { email: 'legacy.manager@org-a.com', password },
        mockReq1,
        mockRes,
      );
      expect(res1.user.email).toBe('legacy.manager@org-a.com');

      const mockReq2 = { ip: '5.6.7.8' } as any;
      const res2 = await authController.login(
        { email: 'legacy.manager@org-a.com', password },
        mockReq2,
        mockRes,
      );
      expect(res2.user.email).toBe('legacy.manager@org-a.com');
    });
  });

  describe('Scenario 5: Tenant Isolation & Password Reset Functional Checks', () => {
    const mockRes = { cookie: jest.fn(), clearCookie: jest.fn() } as any;

    it('should strictly isolate members to their organization and prevent cross-tenant login confusion', async () => {
      const password = 'TenantPass123!';
      const hash = await bcrypt.hash(password, 10);

      // User in Org B
      inMemoryUsers.push({
        id: 'usr-b-1',
        email: 'agent@org-b.com',
        passwordHash: hash,
        role: Role.OPERATOR,
        isActive: true,
        allowedIp: '203.0.113.25',
        organizationId: orgB.id,
      });

      const mockReq = { ip: '203.0.113.25' } as any;
      const res = await authController.login(
        { email: 'agent@org-b.com', password },
        mockReq,
        mockRes,
      );

      expect(res.user.email).toBe('agent@org-b.com');
      expect(res.organization.id).toBe(orgB.id);
      expect(res.organization.id).not.toBe(orgA.id);
    });

    it('should allow password reset for IP-controlled accounts and allow login with new password from valid IP', async () => {
      const oldPassword = 'OldPassword123!';
      const newPassword = 'NewSecretPassword456!';
      const hash = await bcrypt.hash(oldPassword, 10);

      const user = {
        id: 'reset-usr-1',
        email: 'reset.operator@org-a.com',
        passwordHash: hash,
        role: Role.OPERATOR,
        isActive: true,
        allowedIp: '203.0.113.25',
        organizationId: orgA.id,
      };
      inMemoryUsers.push(user);

      // Perform password reset
      const resetResult = await authService.resetPassword({
        email: 'reset.operator@org-a.com',
        newPassword,
      });
      expect(resetResult.success).toBe(true);

      // Verify login with old password fails
      const mockReqValidIp = { ip: '203.0.113.25' } as any;
      await expect(
        authController.login(
          { email: 'reset.operator@org-a.com', password: oldPassword },
          mockReqValidIp,
          mockRes,
        ),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));

      // Verify login with new password succeeds from valid IP
      const loginRes = await authController.login(
        { email: 'reset.operator@org-a.com', password: newPassword },
        mockReqValidIp,
        mockRes,
      );
      expect(loginRes.user.email).toBe('reset.operator@org-a.com');

      // Verify login with new password still rejected from wrong IP
      const mockReqWrongIp = { ip: '198.51.100.99' } as any;
      await expect(
        authController.login(
          { email: 'reset.operator@org-a.com', password: newPassword },
          mockReqWrongIp,
          mockRes,
        ),
      ).rejects.toThrow(new UnauthorizedException('Access denied.'));
    });

    it('should support clean logout by clearing auth cookie', async () => {
      const res = await authController.logout(mockRes);
      expect(res.success).toBe(true);
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'auth_token',
        '',
        expect.objectContaining({ expires: expect.any(Date) }),
      );
    });
  });
});
