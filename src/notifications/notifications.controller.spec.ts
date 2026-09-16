import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { Role } from '@prisma/client';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: NotificationsService;

  const mockUser: AuthenticatedUser = {
    id: 'user-1',
    email: 'user1@example.com',
    organizationId: 'org-1',
    role: Role.OPERATOR,
    firstName: 'Test',
    lastName: 'User',
  };

  const mockNotificationsService = {
    getUserNotifications: jest.fn(),
    getUnreadCount: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call getUserNotifications with user organizationId and userId', async () => {
    mockNotificationsService.getUserNotifications.mockResolvedValue({
      data: [],
      meta: { total: 0, unreadCount: 0, page: 1, limit: 20, totalPages: 0 },
    });

    const dto = { page: 1, limit: 20, unreadOnly: false };
    const res = await controller.getNotifications(mockUser, dto);

    expect(res).toBeDefined();
    expect(mockNotificationsService.getUserNotifications).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      dto,
    );
  });

  it('should call getUnreadCount with user organizationId and userId', async () => {
    mockNotificationsService.getUnreadCount.mockResolvedValue({ unreadCount: 5 });

    const res = await controller.getUnreadCount(mockUser);

    expect(res).toEqual({ unreadCount: 5 });
    expect(mockNotificationsService.getUnreadCount).toHaveBeenCalledWith(
      'org-1',
      'user-1',
    );
  });

  it('should mark single notification as read', async () => {
    mockNotificationsService.markAsRead.mockResolvedValue({ id: 'notif-1', isRead: true });

    const res = await controller.markAsRead(mockUser, 'notif-1');

    expect(res).toEqual({ id: 'notif-1', isRead: true });
    expect(mockNotificationsService.markAsRead).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      'notif-1',
    );
  });

  it('should mark all notifications as read', async () => {
    mockNotificationsService.markAllAsRead.mockResolvedValue({ updatedCount: 3 });

    const res = await controller.markAllAsRead(mockUser);

    expect(res).toEqual({ updatedCount: 3 });
    expect(mockNotificationsService.markAllAsRead).toHaveBeenCalledWith(
      'org-1',
      'user-1',
    );
  });
});
