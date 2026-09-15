import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { Role } from '@prisma/client';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { DEFAULT_LEAD_STATUSES } from '../leads/status.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingOrg = await this.prisma.organization.findUnique({
      where: { slug: dto.organizationSlug.toLowerCase() },
    });

    if (existingOrg) {
      throw new ConflictException(
        `Organization with slug "${dto.organizationSlug}" is already registered`,
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    // Atomic creation of organization, Super Admin user, and baseline statuses
    const { organization, user } = await this.prisma.$transaction(
      async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: dto.organizationName,
            slug: dto.organizationSlug.toLowerCase(),
          },
        });

        const newUser = await tx.user.create({
          data: {
            organizationId: org.id,
            email: dto.email.toLowerCase(),
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: Role.SUPER_ADMIN,
          },
        });

        // Initialize default pipeline statuses for the new organization
        for (const s of DEFAULT_LEAD_STATUSES) {
          await tx.leadStatus.create({
            data: {
              organizationId: org.id,
              name: s.name,
              color: s.color,
              order: s.order,
              isDefault: s.isDefault,
            },
          });
        }

        // Initialize default lead sources
        const defaultSources = ['S6', 'Website', 'Referral', 'Cold Call'];
        for (const src of defaultSources) {
          await tx.leadSource.create({
            data: {
              organizationId: org.id,
              name: src,
            },
          });
        }

        return { organization: org, user: newUser };
      },
    );

    const token = this.generateToken(user);
    this.logger.log(
      `Registered new organization "${organization.name}" and admin "${user.email}"`,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      token,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email.toLowerCase(),
      },
      include: {
        organization: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account has been deactivated');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = this.generateToken(user);
    this.logger.log(
      `User logged in: ${user.email} (${user.role}) in org ${user.organizationId}`,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
      },
      token,
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      organization: {
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
      },
    };
  }

  generateToken(user: {
    id: string;
    email: string;
    organizationId: string;
    role: Role;
  }): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      organizationId: user.organizationId,
      role: user.role,
    };

    return this.jwtService.sign(payload);
  }

  async resetPassword(
    dto: ResetPasswordDto,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email.toLowerCase(), mode: 'insensitive' },
      },
    });

    if (!user) {
      throw new NotFoundException('No account found with this email address');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, this.saltRounds);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    this.logger.log(
      `Password reset successfully for user ${user.id} (${user.email})`,
    );
    return { success: true, message: 'Password has been reset successfully' };
  }

  setAuthCookie(res: Response, token: string): void {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  clearAuthCookie(res: Response): void {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('auth_token', '', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
      expires: new Date(0),
    });
  }
}
