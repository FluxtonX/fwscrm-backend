import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  username?: string | null;
  organizationId: string;
  role: Role;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  username?: string | null;
  organizationId: string;
  role: Role;
  firstName: string;
  lastName: string;
}
