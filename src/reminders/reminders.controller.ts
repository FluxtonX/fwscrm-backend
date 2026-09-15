import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/permissions/permissions.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads/:leadId/reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Post()
  @RequirePermissions(Permission.LEAD_VIEW)
  createReminder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId') leadId: string,
    @Body() dto: CreateReminderDto,
  ) {
    return this.remindersService.create(user.organizationId, leadId, user.id, dto);
  }

  @Get()
  @RequirePermissions(Permission.LEAD_VIEW)
  getReminders(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId') leadId: string,
  ) {
    return this.remindersService.listByLead(user.organizationId, leadId);
  }

  @Patch(':reminderId')
  @RequirePermissions(Permission.LEAD_VIEW)
  updateReminder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reminderId') reminderId: string,
    @Body() dto: UpdateReminderDto,
  ) {
    return this.remindersService.update(
      user.organizationId,
      reminderId,
      user.id,
      dto,
    );
  }

  @Delete(':reminderId')
  @RequirePermissions(Permission.LEAD_VIEW)
  deleteReminder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reminderId') reminderId: string,
  ) {
    return this.remindersService.delete(
      user.organizationId,
      reminderId,
      user.id,
    );
  }
}
