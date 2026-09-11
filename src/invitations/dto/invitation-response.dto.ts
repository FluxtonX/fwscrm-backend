import { Role, InvitationStatus } from '@prisma/client';

export interface InvitationResponseItem {
  id: string;
  email: string;
  role: Role;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  organizationName?: string;
  invitedBy: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export interface ValidatedInvitationInfo {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
}
