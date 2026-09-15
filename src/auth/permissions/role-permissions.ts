import { Role } from '@prisma/client';
import { Permission } from './permissions.enum';

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.SUPER_ADMIN]: Object.values(Permission),

  [Role.ADMIN]: Object.values(Permission),

  [Role.MANAGER]: [
    // Lead operations (sees all leads, creates, edits, assigns owner, imports, exports)
    Permission.LEAD_VIEW,
    Permission.LEAD_CREATE,
    Permission.LEAD_EDIT,
    Permission.LEAD_ASSIGN_OWNER,
    Permission.LEAD_IMPORT,
    Permission.LEAD_EXPORT,
    Permission.LEAD_SEND_NUMBERS,

    // Notes
    Permission.NOTE_CREATE,
    Permission.NOTE_EDIT,
    Permission.NOTE_DELETE,

    // User inspection only (cannot invite, edit roles, or deactivate)
    Permission.USER_VIEW,

    // Views
    Permission.ANALYTICS_VIEW,
    Permission.ACTIVITY_VIEW,
    Permission.SETTINGS_VIEW,
  ],

  [Role.OPERATOR]: [
    // Operational lead access (sees all leads, views details, approved communication action)
    Permission.LEAD_VIEW,
    Permission.LEAD_SEND_NUMBERS,

    // Notes
    Permission.NOTE_CREATE,

    // Activity view
    Permission.ACTIVITY_VIEW,
  ],

  // Legacy mappings for backwards compatibility
  [Role.AGENT]: [
    Permission.LEAD_VIEW,
    Permission.LEAD_CREATE,
    Permission.LEAD_EDIT,
    Permission.LEAD_SEND_NUMBERS,
    Permission.NOTE_CREATE,
    Permission.ACTIVITY_VIEW,
    Permission.ANALYTICS_VIEW,
  ],

  [Role.VIEWER]: [
    Permission.LEAD_VIEW,
    Permission.ACTIVITY_VIEW,
    Permission.ANALYTICS_VIEW,
  ],
};

/**
 * Validates whether a given role is granted a specific permission.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) {
    return false;
  }
  return permissions.includes(permission);
}

/**
 * Returns all permissions associated with a given role.
 */
export function getPermissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}
