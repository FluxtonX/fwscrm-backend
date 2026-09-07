import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { LeadsService } from './leads.service';
import { LeadStatusService } from './status.service';
import { LeadSourceService } from './source.service';
import { CountryService } from './country.service';
import { QueryLeadsDto } from './dto/query-leads.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import {
  BulkAssignDto,
  BulkUpdateStatusDto,
  BulkDeleteDto,
} from './dto/bulk-action.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly statusService: LeadStatusService,
    private readonly sourceService: LeadSourceService,
    private readonly countryService: CountryService,
  ) {}

  @Get('meta/statuses')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  getStatuses(@CurrentUser() user: AuthenticatedUser) {
    return this.statusService.listByOrganization(user.organizationId);
  }

  @Get('meta/sources')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  getSources(@CurrentUser() user: AuthenticatedUser) {
    return this.sourceService.listByOrganization(user.organizationId);
  }

  @Get('meta/countries')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  getCountries() {
    return this.countryService.listAll();
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryLeadsDto,
  ) {
    return this.leadsService.findAll(user.organizationId, query);
  }

  @Get('export')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT)
  async exportCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryLeadsDto,
    @Res() res: Response,
  ) {
    const csv = await this.leadsService.exportLeadsToCsv(
      user.organizationId,
      query,
    );
    const filename = `leads_export_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT)
  async exportSelectedCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { leadIds?: string[] },
    @Res() res: Response,
  ) {
    const csv = await this.leadsService.exportLeadsToCsv(
      user.organizationId,
      {},
      body.leadIds,
    );
    const filename = `leads_export_selected_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT, Role.VIEWER)
  findById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.leadsService.findById(user.organizationId, id);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLeadDto) {
    return this.leadsService.create(user.organizationId, dto, user.id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadsService.update(user.organizationId, id, dto, user.id);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.leadsService.delete(user.organizationId, id);
  }

  @Post('bulk/assign')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  bulkAssign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkAssignDto,
  ) {
    return this.leadsService.bulkAssign(
      user.organizationId,
      dto.leadIds,
      dto.ownerId,
    );
  }

  @Post('bulk/status')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  bulkUpdateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkUpdateStatusDto,
  ) {
    return this.leadsService.bulkUpdateStatus(
      user.organizationId,
      dto.leadIds,
      dto.statusId,
    );
  }

  @Post('bulk/delete')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  bulkDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkDeleteDto,
  ) {
    return this.leadsService.bulkDelete(user.organizationId, dto.leadIds);
  }
}
