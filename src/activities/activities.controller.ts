import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get('leads/:leadId/activities')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  getLeadActivities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId') leadId: string,
  ) {
    return this.activitiesService.getLeadActivities(
      user.organizationId,
      leadId,
    );
  }

  @Get('activities/recent')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  getRecentActivities(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: number,
  ) {
    return this.activitiesService.getOrganizationActivities(
      user.organizationId,
      limit ? Number(limit) : 10,
    );
  }
}
