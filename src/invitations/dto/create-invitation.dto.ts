import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsIn,
  IsOptional,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Role, AccessType } from '@prisma/client';

export class CreateInvitationDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  @IsNotEmpty({ message: 'Email address is required' })
  @Transform(({ value }: { value: string }) => value?.trim().toLowerCase())
  email!: string;

  @IsIn([Role.MANAGER, Role.OPERATOR], {
    message: 'Role must be either MANAGER or OPERATOR',
  })
  @IsNotEmpty({ message: 'Role designation is required' })
  role!: Role;

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
