import { IsOptional, IsString, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { AccessType } from '@prisma/client';

export class UpdateUserIpDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: string | null | undefined }) =>
    value !== undefined && value !== null ? value.trim() : value,
  )
  allowedIp?: string | null;

  @IsOptional()
  @IsIn([AccessType.PERMANENT, AccessType.TEMPORARY, null], {
    message: 'Access type must be either PERMANENT, TEMPORARY, or null',
  })
  accessType?: AccessType | null;

  @IsOptional()
  @IsString()
  accessExpiresAt?: string | null;
}
