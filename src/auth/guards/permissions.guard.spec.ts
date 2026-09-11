import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PermissionsGuard } from './permissions.guard';
import { Permission } from '../permissions/permissions.enum';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  const createMockContext = (user: any): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as any;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  it('should allow access if no permissions are specified on route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);
    const context = createMockContext({ role: Role.OPERATOR });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow SUPER_ADMIN access to any permission', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Permission.USER_INVITE, Permission.SETTINGS_MANAGE]);
    const context = createMockContext({ role: Role.SUPER_ADMIN });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow MANAGER access to approved lead management permissions', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([
        Permission.LEAD_VIEW,
        Permission.LEAD_CREATE,
        Permission.LEAD_EDIT,
        Permission.LEAD_IMPORT,
      ]);
    const context = createMockContext({ role: Role.MANAGER });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny MANAGER access to USER_INVITE or LEAD_DELETE', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Permission.USER_INVITE]);
    const context = createMockContext({ role: Role.MANAGER });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow OPERATOR access to LEAD_VIEW', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Permission.LEAD_VIEW]);
    const context = createMockContext({ role: Role.OPERATOR });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny OPERATOR access to LEAD_EDIT and LEAD_IMPORT', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Permission.LEAD_EDIT]);
    const context = createMockContext({ role: Role.OPERATOR });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow OPERATOR access to LEAD_SEND_NUMBERS', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Permission.LEAD_SEND_NUMBERS]);
    const context = createMockContext({ role: Role.OPERATOR });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow MANAGER access to USER_VIEW but deny USER_EDIT_ROLE and USER_DEACTIVATE', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Permission.USER_VIEW]);
    const context = createMockContext({ role: Role.MANAGER });

    expect(guard.canActivate(context)).toBe(true);

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Permission.USER_EDIT_ROLE]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Permission.USER_DEACTIVATE]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException if user has no role or is unauthenticated', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Permission.LEAD_VIEW]);
    const context = createMockContext(null);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
