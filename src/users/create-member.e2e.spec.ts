import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PrismaService } from '../database/prisma.service';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('Direct Member Creation - E2E Security & Functional Suite', () => {
  let controller: UsersController;
  let service: UsersService;
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  const mockOrgId = 'org-tenant-a';
  const superAdminCaller = {
    id: 'super-admin-1',
    organizationId: mockOrgId,
    email: 'superadmin@company.com',
    role: Role.SUPER_ADMIN,
  };

  const managerCaller = {
    id: 'manager-1',
    organizationId: mockOrgId,
    email: 'manager@company.com',
    role: Role.MANAGER,
  };

  const operatorCaller = {
    id: 'operator-1',
    organizationId: mockOrgId,
    email: 'operator@company.com',
    role: Role.OPERATOR,
  };

  let dbUsers: any[] = [];
  let dbAuditLogs: any[] = [];

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(({ where }: any) => {
        if (where.organizationId_email) {
          const found = dbUsers.find(
            (u) =>
              u.organizationId === where.organizationId_email.organizationId &&
              u.email.toLowerCase() === where.organizationId_email.email.toLowerCase(),
          );
          return Promise.resolve(found || null);
        }
        return Promise.resolve(null);
      }),
      create: jest.fn(({ data, select }: any) => {
        const record = {
          id: `user-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        dbUsers.push(record);
        if (select) {
          const filtered: any = {};
          for (const key of Object.keys(select)) {
            if (select[key]) filtered[key] = record[key];
          }
          return Promise.resolve(filtered);
        }
        return Promise.resolve(record);
      }),
    },
    auditLog: {
      create: jest.fn(({ data }: any) => {
        const log = { id: `log-${Date.now()}`, ...data, createdAt: new Date() };
        dbAuditLogs.push(log);
        return Promise.resolve(log);
      }),
    },
  };

  beforeEach(async () => {
    dbUsers = [];
    dbAuditLogs = [];
    jest.clearAllMocks();

    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: Reflector, useValue: reflector },
        RolesGuard,
        PermissionsGuard,
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);
  });

  const checkRolesGuard = (user: any): boolean => {
    const context = {
      getHandler: () => controller.createMember,
      getClass: () => UsersController,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as any;
    return rolesGuard.canActivate(context);
  };

  describe('1. Super Admin Authorization & RBAC Enforcement', () => {
    it('should allow Super Admin to access createMember', () => {
      expect(checkRolesGuard(superAdminCaller)).toBe(true);
    });

    it('should forbid Manager from calling createMember with 403 Forbidden', () => {
      expect(() => checkRolesGuard(managerCaller)).toThrow(ForbiddenException);
    });

    it('should forbid Operator from calling createMember with 403 Forbidden', () => {
      expect(() => checkRolesGuard(operatorCaller)).toThrow(ForbiddenException);
    });
  });

  describe('2. Direct Member Creation - Manager Account', () => {
    it('should successfully create Manager account, hash password with bcrypt, and emit audit log', async () => {
      const password = 'ManagerPassword123!';
      const result = await controller.createMember(superAdminCaller as any, {
        email: 'alice.manager@example.com',
        password,
        confirmPassword: password,
        role: Role.MANAGER,
        firstName: 'Alice',
        lastName: 'Smith',
      });

      // Verification of returned object
      expect(result.id).toBeDefined();
      expect(result.email).toBe('alice.manager@example.com');
      expect(result.role).toBe(Role.MANAGER);
      expect(result.firstName).toBe('Alice');
      expect(result.lastName).toBe('Smith');
      expect(result.isActive).toBe(true);
      expect((result as any).password).toBeUndefined();
      expect((result as any).passwordHash).toBeUndefined();

      // Verify DB storage
      const stored = dbUsers.find((u) => u.email === 'alice.manager@example.com');
      expect(stored).toBeDefined();
      expect(stored.passwordHash).toBeDefined();
      expect(stored.passwordHash).not.toBe(password);
      const isPasswordValid = await bcrypt.compare(password, stored.passwordHash);
      expect(isPasswordValid).toBe(true);

      // Verify Tenant Isolation
      expect(stored.organizationId).toBe(mockOrgId);

      // Verify Audit Log
      const audit = dbAuditLogs.find((l) => l.targetId === result.id);
      expect(audit).toBeDefined();
      expect(audit.action).toBe('user.created');
      expect(audit.actorId).toBe(superAdminCaller.id);
      expect(audit.organizationId).toBe(mockOrgId);
      expect(audit.metadata.email).toBe('alice.manager@example.com');
      expect(audit.metadata.role).toBe(Role.MANAGER);
    });
  });

  describe('3. Direct Member Creation - Operator Account', () => {
    it('should successfully create Operator account with auto-derived name when omitted', async () => {
      const password = 'OperatorPassword123!';
      const result = await controller.createMember(superAdminCaller as any, {
        email: 'bob.operator@example.com',
        password,
        confirmPassword: password,
        role: Role.OPERATOR,
      });

      expect(result.id).toBeDefined();
      expect(result.email).toBe('bob.operator@example.com');
      expect(result.role).toBe(Role.OPERATOR);
      expect(result.firstName).toBe('bob.operator'); // Derived from email prefix
      expect(result.lastName).toBe('');
      expect(result.isActive).toBe(true);

      // Verify DB password hash
      const stored = dbUsers.find((u) => u.email === 'bob.operator@example.com');
      const isMatch = await bcrypt.compare(password, stored.passwordHash);
      expect(isMatch).toBe(true);
    });
  });

  describe('4. Security & Role Invariant Enforcement', () => {
    it('should strictly reject creating SUPER_ADMIN role through Add Member', async () => {
      await expect(
        controller.createMember(superAdminCaller as any, {
          email: 'illegal.sa@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          role: Role.SUPER_ADMIN,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should strictly reject creating ADMIN role through Add Member', async () => {
      await expect(
        controller.createMember(superAdminCaller as any, {
          email: 'illegal.admin@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          role: Role.ADMIN,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should enforce password confirmation match', async () => {
      await expect(
        controller.createMember(superAdminCaller as any, {
          email: 'mismatch@example.com',
          password: 'Password123!',
          confirmPassword: 'DifferentPassword123!',
          role: Role.OPERATOR,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should enforce duplicate email uniqueness within tenant', async () => {
      const password = 'Password123!';
      await controller.createMember(superAdminCaller as any, {
        email: 'duplicate@example.com',
        password,
        confirmPassword: password,
        role: Role.OPERATOR,
      });

      await expect(
        controller.createMember(superAdminCaller as any, {
          email: 'duplicate@example.com',
          password,
          confirmPassword: password,
          role: Role.MANAGER,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('5. Tenant Isolation Guarantee', () => {
    it('should strictly bind new user to the caller organization, ignoring cross-tenant payload manipulation', async () => {
      const maliciousCaller = {
        id: 'admin-tenant-b',
        organizationId: 'org-tenant-b',
        email: 'admin.b@company.com',
        role: Role.SUPER_ADMIN,
      };

      const result = await controller.createMember(maliciousCaller as any, {
        email: 'tenant.b.user@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        role: Role.OPERATOR,
      });

      expect(result.organizationId).toBe('org-tenant-b');
      expect(result.organizationId).not.toBe('org-tenant-a');
    });
  });
});
