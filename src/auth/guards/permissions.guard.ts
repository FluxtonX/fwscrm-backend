import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { Permission } from '../permissions/permissions.enum';
import { hasPermission } from '../permissions/role-permissions';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;

    if (!user || !user.role) {
      throw new ForbiddenException('Access denied: User has no assigned role or valid session');
    }

    // Super Admin and Admin have unrestricted access
    if (user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN) {
      return true;
    }

    for (const permission of requiredPermissions) {
      if (!hasPermission(user.role, permission)) {
        throw new ForbiddenException(
          `Access denied: Your role (${user.role}) lacks the required permission (${permission}) for this operation`,
        );
      }
    }

    return true;
  }
}
