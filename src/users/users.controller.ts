import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/permissions/permissions.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { UpdateUserRoleDto } from './dto/update-role.dto';
import { UpdateUserStatusDto } from './dto/update-status.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions(Permission.USER_VIEW)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.listByOrganization(user.organizationId, true);
  }

  @Patch(':id/role')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.USER_EDIT_ROLE)
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.usersService.updateRole(
      user.organizationId,
      id,
      dto.role,
      user.id,
    );
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.USER_DEACTIVATE)
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.updateStatus(
      user.organizationId,
      id,
      dto.isActive,
      user.id,
    );
  }
}
