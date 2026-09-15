export enum Permission {
  // Lead Permissions
  LEAD_VIEW = 'lead.view',
  LEAD_CREATE = 'lead.create',
  LEAD_EDIT = 'lead.edit',
  LEAD_DELETE = 'lead.delete',
  LEAD_ASSIGN_OWNER = 'lead.assign_owner',
  LEAD_IMPORT = 'lead.import',
  LEAD_EXPORT = 'lead.export',
  LEAD_SEND_NUMBERS = 'lead.send_numbers',

  // Note Permissions
  NOTE_CREATE = 'note.create',
  NOTE_EDIT = 'note.edit',
  NOTE_DELETE = 'note.delete',

  // User & Team Permissions
  USER_VIEW = 'user.view',
  USER_INVITE = 'user.invite',
  USER_EDIT_ROLE = 'user.edit_role',
  USER_DEACTIVATE = 'user.deactivate',
  USER_REACTIVATE = 'user.reactivate',

  // Analytics & Activity Permissions
  ANALYTICS_VIEW = 'analytics.view',
  ACTIVITY_VIEW = 'activity.view',

  // Settings & Audit Permissions
  SETTINGS_VIEW = 'settings.view',
  SETTINGS_MANAGE = 'settings.manage',
  AUDIT_VIEW = 'audit.view',
}
