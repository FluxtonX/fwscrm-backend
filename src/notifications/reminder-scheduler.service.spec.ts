import { Test, TestingModule } from '@nestjs/testing';
import { ReminderSchedulerService } from './reminder-scheduler.service';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../database/prisma.service';

describe('ReminderSchedulerService', () => {
  let service: ReminderSchedulerService;
  let notificationsService: NotificationsService;
  let prisma: PrismaService;

  const mockPrisma = {
    leadReminder: {
      findMany: jest.fn(),
    },
  };

  const mockNotificationsService = {
    createDueNotification: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReminderSchedulerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<ReminderSchedulerService>(ReminderSchedulerService);
    notificationsService = module.get<NotificationsService>(NotificationsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should scan due reminders and trigger createDueNotification', async () => {
    const dueDate = new Date();
    mockPrisma.leadReminder.findMany.mockResolvedValue([
      {
        id: 'rem-1',
        organizationId: 'org-1',
        leadId: 'lead-1',
        userId: 'user-1',
        title: 'Call prospect',
        dueDate,
        isCompleted: false,
        lead: {
          id: 'lead-1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
        },
      },
    ]);

    await service.checkDueReminders();

    expect(mockPrisma.leadReminder.findMany).toHaveBeenCalled();
    expect(mockNotificationsService.createDueNotification).toHaveBeenCalledWith({
      organizationId: 'org-1',
      recipientUserId: 'user-1',
      relatedLeadId: 'lead-1',
      relatedFollowUpId: 'rem-1',
      dueDate,
      title: 'Follow-Up Due: Call prospect',
      message: 'Follow-up "Call prospect" for John Doe is due now.',
    });
  });

  it('should handle empty due reminders without errors', async () => {
    mockPrisma.leadReminder.findMany.mockResolvedValue([]);

    await service.checkDueReminders();

    expect(mockPrisma.leadReminder.findMany).toHaveBeenCalled();
    expect(mockNotificationsService.createDueNotification).not.toHaveBeenCalled();
  });
});
