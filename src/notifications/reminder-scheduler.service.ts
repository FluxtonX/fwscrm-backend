import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class ReminderSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderSchedulerService.name);
  private intervalRef: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit() {
    this.logger.log('Initializing ReminderSchedulerService (interval: 30 seconds)');
    // Initial run after 5 seconds to let server finish bootstrap
    setTimeout(() => {
      this.checkDueReminders();
    }, 5000);

    // Schedule regular check every 30 seconds
    this.intervalRef = setInterval(() => {
      this.checkDueReminders();
    }, 30000);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  async checkDueReminders() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = new Date();

      // Find all incomplete reminders whose due date is <= now and have an assigned user
      const dueReminders = await this.prisma.leadReminder.findMany({
        where: {
          isCompleted: false,
          dueDate: { lte: now },
        },
        include: {
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        take: 100, // Process in batches if high volume
      });

      if (dueReminders.length > 0) {
        this.logger.debug(`Found ${dueReminders.length} due follow-ups to process`);
      }

      for (const reminder of dueReminders) {
        if (!reminder.userId) continue;

        const leadName = reminder.lead
          ? `${reminder.lead.firstName || ''} ${reminder.lead.lastName || ''}`.trim() || reminder.lead.email || 'Lead'
          : 'Lead';

        await this.notificationsService.createDueNotification({
          organizationId: reminder.organizationId,
          recipientUserId: reminder.userId,
          relatedLeadId: reminder.leadId,
          relatedFollowUpId: reminder.id,
          dueDate: reminder.dueDate,
          title: `Follow-Up Due: ${reminder.title}`,
          message: `Follow-up "${reminder.title}" for ${leadName} is due now.`,
        });
      }
    } catch (err: any) {
      this.logger.error(`Error checking due reminders: ${err?.message}`, err?.stack);
    } finally {
      this.isProcessing = false;
    }
  }
}
