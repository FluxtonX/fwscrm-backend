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
  BulkTagDto,
} from './dto/bulk-action.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/permissions/permissions.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly statusService: LeadStatusService,
    private readonly sourceService: LeadSourceService,
    private readonly countryService: CountryService,
  ) {}

  @Get('meta/statuses')
  @RequirePermissions(Permission.LEAD_VIEW)
  getStatuses(@CurrentUser() user: AuthenticatedUser) {
    return this.statusService.listByOrganization(user.organizationId);
  }

  @Get('meta/sources')
  @RequirePermissions(Permission.LEAD_VIEW)
  getSources(@CurrentUser() user: AuthenticatedUser) {
    return this.sourceService.listByOrganization(user.organizationId);
  }

  @Get('meta/countries')
  @RequirePermissions(Permission.LEAD_VIEW)
  getCountries() {
    return this.countryService.listAll();
  }

  @Get()
  @RequirePermissions(Permission.LEAD_VIEW)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryLeadsDto,
  ) {
    return this.leadsService.findAll(user.organizationId, query, user.id);
  }


  @Get('export')
  @RequirePermissions(Permission.LEAD_EXPORT)
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
  @RequirePermissions(Permission.LEAD_EXPORT)
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
  @RequirePermissions(Permission.LEAD_VIEW)
  findById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.leadsService.findById(user.organizationId, id);
  }

  @Post()
  @RequirePermissions(Permission.LEAD_CREATE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLeadDto) {
    return this.leadsService.create(user.organizationId, dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.LEAD_EDIT)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadsService.update(user.organizationId, id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions(Permission.LEAD_DELETE)
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.leadsService.delete(user.organizationId, id);
  }

  @Post('bulk/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.LEAD_ASSIGN_OWNER)
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
  @RequirePermissions(Permission.LEAD_EDIT)
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
  @RequirePermissions(Permission.LEAD_DELETE)
  bulkDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkDeleteDto,
  ) {
    return this.leadsService.bulkDelete(user.organizationId, dto.leadIds);
  }

  @Post('bulk/tag')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.LEAD_EDIT)
  bulkTag(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkTagDto,
  ) {
    return this.leadsService.bulkTag(
      user.organizationId,
      dto.leadIds,
      dto.tag,
      dto.action,
    );
  }
}
