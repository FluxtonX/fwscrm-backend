import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';
import { Role } from '@prisma/client';

export class CreateInvitationDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email address is required' })
  @Transform(({ value }: { value: string }) => value?.trim().toLowerCase())
  email: string;

  @IsEnum(Role, {
    message: 'Role must be one of: SUPER_ADMIN, MANAGER, OPERATOR',
  })
  @IsNotEmpty({ message: 'Role designation is required' })
  role: Role;
}
