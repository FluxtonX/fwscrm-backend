import { IsEnum, IsNotEmpty } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserRoleDto {
  @IsEnum(Role, {
    message: 'Role must be one of: SUPER_ADMIN, MANAGER, OPERATOR',
  })
  @IsNotEmpty({ message: 'Role is required' })
  role: Role;
}
