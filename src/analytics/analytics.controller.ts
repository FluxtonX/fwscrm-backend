import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  getDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query('timeframe') timeframe?: string,
  ) {
    return this.analyticsService.getDashboard(
      user.organizationId,
      timeframe || '30d',
    );
  }

  @Get('overview')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  getOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.getOverview(user.organizationId);
  }

  @Get('status-distribution')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  getStatusDistribution(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.getStatusDistribution(user.organizationId);
  }

  @Get('source-distribution')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  getSourceDistribution(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.getSourceDistribution(user.organizationId);
  }

  @Get('trend')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  getTrend(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days') days?: number,
  ) {
    return this.analyticsService.getTimelineTrend(
      user.organizationId,
      days ? Number(days) : 14,
    );
  }
}
