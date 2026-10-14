import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsIn,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Role, AccessType } from '@prisma/client';

export class CreateMemberDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters long' })
  @MaxLength(50, { message: 'Username cannot exceed 50 characters' })
  @Transform(({ value }: { value: string }) => (value ? value.trim().toLowerCase() : undefined))
  username?: string;

  @IsOptional()
  @IsEmail({}, { message: 'A valid email address is required' })
  @Transform(({ value }: { value: string }) => (value ? value.trim().toLowerCase() : undefined))
  email?: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Confirm password is required' })
  confirmPassword!: string;

  @IsIn([Role.MANAGER, Role.OPERATOR], {
    message: 'Role must be either MANAGER or OPERATOR',
  })
  @IsNotEmpty({ message: 'Role designation is required' })
  role!: Role;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  lastName?: string;

  @IsOptional()
  @IsIn([AccessType.PERMANENT, AccessType.TEMPORARY], {
    message: 'Access type must be either PERMANENT or TEMPORARY',
  })
  accessType?: AccessType;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: string }) => (value ? value.trim() : undefined))
  allowedIp?: string;

  @IsOptional()
  @IsString()
  accessExpiresAt?: string;
}
