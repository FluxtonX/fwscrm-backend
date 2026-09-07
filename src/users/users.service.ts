import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { User, Role } from '@prisma/client';

export interface CreateUserData {
  organizationId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role?: Role;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateUserData): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId: data.organizationId,
          email: data.email.toLowerCase(),
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `User with email "${data.email}" already exists in this organization`,
      );
    }

    const user = await this.prisma.user.create({
      data: {
        organizationId: data.organizationId,
        email: data.email.toLowerCase(),
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role || Role.AGENT,
      },
    });

    this.logger.log(
      `Created user "${user.email}" (${user.role}) in org ${data.organizationId}`,
    );
    return user;
  }

  async findByEmail(
    organizationId: string,
    email: string,
  ): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId,
          email: email.toLowerCase(),
        },
      },
    });
  }

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return user;
  }

  async listByOrganization(
    organizationId: string,
  ): Promise<Omit<User, 'passwordHash'>[]> {
    return this.prisma.user.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        organizationId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { lastName: 'asc' },
    });
  }
}
