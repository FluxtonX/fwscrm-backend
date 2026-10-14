import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/permissions/permissions.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @RequirePermissions(Permission.TEAM_MANAGE)
  async createTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTeamDto,
  ) {
    return this.teamsService.createTeam(user.organizationId, user.id, dto);
  }

  @Get()
  @RequirePermissions(Permission.TEAM_VIEW)
  async listTeams(@CurrentUser() user: AuthenticatedUser) {
    return this.teamsService.listTeams(user.organizationId, user.id, user.role);
  }

  @Get('my-team')
  @RequirePermissions(Permission.TEAM_VIEW)
  async getMyTeam(@CurrentUser() user: AuthenticatedUser) {
    return this.teamsService.getMyTeam(user.organizationId, user.id);
  }

  @Get(':id')
  @RequirePermissions(Permission.TEAM_VIEW)
  async getTeamById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.teamsService.getTeamById(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.TEAM_MANAGE)
  async updateTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teamsService.updateTeam(user.organizationId, id, user.id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.TEAM_MANAGE)
  async deleteTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.teamsService.deleteTeam(user.organizationId, id, user.id);
  }

  @Post(':id/members')
  @RequirePermissions(Permission.TEAM_MANAGE)
  async addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teamsService.addMember(user.organizationId, id, user.id, dto);
  }

  @Delete(':id/members/:userId')
  @RequirePermissions(Permission.TEAM_MANAGE)
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.teamsService.removeMember(user.organizationId, id, userId, user.id);
  }
}
