import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { PrismaService } from '../database/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: PrismaService;

  const mockPrisma = {
    notification: {
      create: jest.fn(),
    },
  };

  const mockGateway = {
    sendNotificationToUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a FOLLOW_UP_DUE notification successfully', async () => {
    const now = new Date();
    mockPrisma.notification.create.mockResolvedValue({
      id: 'notif-1',
      organizationId: 'org-1',
      recipientUserId: 'user-1',
      type: 'FOLLOW_UP_DUE',
      title: 'Follow-Up Due',
      message: 'Due now',
      relatedLeadId: 'lead-1',
      relatedFollowUpId: 'rem-1',
      dueOccurrence: now.toISOString(),
      isRead: false,
      createdAt: now,
      readAt: null,
    });

    const result = await service.createDueNotification({
      organizationId: 'org-1',
      recipientUserId: 'user-1',
      relatedLeadId: 'lead-1',
      relatedFollowUpId: 'rem-1',
      dueDate: now,
      title: 'Follow-Up Due',
      message: 'Due now',
    });

    expect(result).toBeDefined();
    expect(result?.id).toBe('notif-1');
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        recipientUserId: 'user-1',
        type: 'FOLLOW_UP_DUE',
        title: 'Follow-Up Due',
        message: 'Due now',
        relatedLeadId: 'lead-1',
        relatedFollowUpId: 'rem-1',
        dueOccurrence: now.toISOString(),
      },
    });
  });

  it('should return null gracefully on duplicate unique constraint violation (P2002)', async () => {
    const now = new Date();
    const p2002Error: any = new Error('Unique constraint failed');
    p2002Error.code = 'P2002';
    mockPrisma.notification.create.mockRejectedValue(p2002Error);

    const result = await service.createDueNotification({
      organizationId: 'org-1',
      recipientUserId: 'user-1',
      relatedLeadId: 'lead-1',
      relatedFollowUpId: 'rem-1',
      dueDate: now,
      title: 'Follow-Up Due',
      message: 'Due now',
    });

    expect(result).toBeNull();
  });
});
