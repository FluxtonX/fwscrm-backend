import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';

export type FollowUpStatus = 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING' | 'COMPLETED';

export function computeFollowUpStatus(dueDate: Date, isCompleted: boolean): FollowUpStatus {
  if (isCompleted) return 'COMPLETED';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (dueDate.getTime() < startOfToday.getTime()) {
    return 'OVERDUE';
  } else if (dueDate.getTime() <= endOfToday.getTime()) {
    return 'DUE_TODAY';
  } else {
    return 'UPCOMING';
  }
}

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(private readonly prisma: PrismaService) {}

  private enrichReminder<T extends { dueDate: Date; isCompleted: boolean }>(reminder: T) {
    return {
      ...reminder,
      status: computeFollowUpStatus(reminder.dueDate, reminder.isCompleted),
    };
  }

  private async logActivity(
    organizationId: string,
    leadId: string,
    userId: string,
    description: string,
    metadata: Record<string, any>,
  ) {
    try {
      await this.prisma.leadActivity.create({
        data: {
          organizationId,
          leadId,
          userId,
          type: 'UPDATED',
          description,
          metadata,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Failed to log follow-up activity on lead ${leadId}: ${err?.message}`);
    }
  }

  async create(
    organizationId: string,
    leadId: string,
    currentUserId: string,
    dto: CreateReminderDto,
  ) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID "${leadId}" not found`);
    }

    let targetUserId = currentUserId;
    if (dto.assignedUserId) {
      const assignedUser = await this.prisma.user.findFirst({
        where: { id: dto.assignedUserId, organizationId },
      });
      if (!assignedUser) {
        throw new BadRequestException(`Assigned user "${dto.assignedUserId}" not found in organization`);
      }
      targetUserId = assignedUser.id;
    }

    const dueDate = new Date(dto.dueDate);
    const reminder = await this.prisma.leadReminder.create({
      data: {
        organizationId,
        leadId,
        userId: targetUserId,
        title: dto.title.trim(),
        dueDate,
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
      },
    });

    await this.logActivity(
      organizationId,
      leadId,
      currentUserId,
      `Scheduled follow-up: "${reminder.title}" for ${dueDate.toLocaleDateString()} ${dueDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      {
        action: 'FOLLOW_UP_SCHEDULED',
        reminderId: reminder.id,
        dueDate: reminder.dueDate,
        title: reminder.title,
        assignedUserId: targetUserId,
      },
    );

    this.logger.log(`Created reminder ${reminder.id} on lead ${leadId} by user ${currentUserId}`);
    return this.enrichReminder(reminder);
  }

  async listByLead(organizationId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID "${leadId}" not found`);
    }

    const reminders = await this.prisma.leadReminder.findMany({
      where: {
        organizationId,
        leadId,
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    return reminders.map((r) => this.enrichReminder(r));
  }

  async update(
    organizationId: string,
    reminderId: string,
    userId: string,
    dto: UpdateReminderDto,
  ) {
    const reminder = await this.prisma.leadReminder.findFirst({
      where: { id: reminderId, organizationId },
    });

    if (!reminder) {
      throw new NotFoundException(`Reminder with ID "${reminderId}" not found`);
    }

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate);
    if (dto.isCompleted !== undefined) data.isCompleted = dto.isCompleted;

    if (dto.assignedUserId) {
      const assignedUser = await this.prisma.user.findFirst({
        where: { id: dto.assignedUserId, organizationId },
      });
      if (!assignedUser) {
        throw new BadRequestException(`Assigned user "${dto.assignedUserId}" not found in organization`);
      }
      data.userId = assignedUser.id;
    }

    const updated = await this.prisma.leadReminder.update({
      where: { id: reminderId },
      data,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
      },
    });

    // Log complete vs reschedule activity
    if (dto.isCompleted === true && !reminder.isCompleted) {
      await this.logActivity(
        organizationId,
        reminder.leadId,
        userId,
        `Completed follow-up: "${reminder.title}"`,
        {
          action: 'FOLLOW_UP_COMPLETED',
          reminderId: reminder.id,
        },
      );
    } else if (dto.dueDate && new Date(dto.dueDate).getTime() !== reminder.dueDate.getTime()) {
      const newDate = new Date(dto.dueDate);
      await this.logActivity(
        organizationId,
        reminder.leadId,
        userId,
        `Rescheduled follow-up "${reminder.title}" to ${newDate.toLocaleDateString()} ${newDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        {
          action: 'FOLLOW_UP_RESCHEDULED',
          reminderId: reminder.id,
          previousDueDate: reminder.dueDate,
          newDueDate: newDate,
        },
      );
    }

    this.logger.log(`Updated reminder ${reminderId} on lead ${reminder.leadId}`);
    return this.enrichReminder(updated);
  }

  async delete(organizationId: string, reminderId: string, userId: string) {
    const reminder = await this.prisma.leadReminder.findFirst({
      where: { id: reminderId, organizationId },
    });

    if (!reminder) {
      throw new NotFoundException(`Reminder with ID "${reminderId}" not found`);
    }

    await this.prisma.leadReminder.delete({
      where: { id: reminderId },
    });

    await this.logActivity(
      organizationId,
      reminder.leadId,
      userId,
      `Cancelled follow-up: "${reminder.title}"`,
      {
        action: 'FOLLOW_UP_CANCELLED',
        reminderId: reminder.id,
        title: reminder.title,
      },
    );

    this.logger.log(`Deleted reminder ${reminderId} from lead ${reminder.leadId}`);
    return { success: true };
  }
}

