import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

export interface CreateDueNotificationParams {
  organizationId: string;
  recipientUserId: string;
  relatedLeadId: string;
  relatedFollowUpId: string;
  dueDate: Date;
  title: string;
  message: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  /**
   * Idempotently creates a FOLLOW_UP_DUE notification.
   * If a notification for the same (organizationId, relatedFollowUpId, type, dueOccurrence)
   * already exists, Prisma throws P2002 (unique constraint error) and we return null safely.
   */
  async createDueNotification(params: CreateDueNotificationParams) {
    const {
      organizationId,
      recipientUserId,
      relatedLeadId,
      relatedFollowUpId,
      dueDate,
      title,
      message,
    } = params;

    const dueOccurrence = dueDate.toISOString();

    try {
      const notification = await this.prisma.notification.create({
        data: {
          organizationId,
          recipientUserId,
          type: 'FOLLOW_UP_DUE',
          title,
          message,
          relatedLeadId,
          relatedFollowUpId,
          dueOccurrence,
        },
      });

      this.logger.log(
        `Created due notification ${notification.id} for user ${recipientUserId} (FollowUp: ${relatedFollowUpId})`,
      );

      // Emit real-time notification to user's isolated room
      try {
        this.gateway.sendNotificationToUser(organizationId, recipientUserId, notification);
      } catch (wsErr: any) {
        this.logger.warn(`Failed to send real-time socket event: ${wsErr?.message}`);
      }

      return notification;
    } catch (err: any) {
      if (err.code === 'P2002') {
        // Unique constraint violation: Notification already generated for this occurrence
        this.logger.debug(
          `Notification already exists for followUp ${relatedFollowUpId} at ${dueOccurrence}`,
        );
        return null;
      }
      this.logger.error(`Error creating notification: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Idempotently creates an instant FOLLOW_UP_ASSIGNED notification
   * when a follow-up is scheduled/assigned to a CRM user.
   */
  async createAssignedNotification(params: CreateDueNotificationParams) {
    const {
      organizationId,
      recipientUserId,
      relatedLeadId,
      relatedFollowUpId,
      dueDate,
      title,
      message,
    } = params;

    const dueOccurrence = dueDate ? dueDate.toISOString() : undefined;

    try {
      const notification = await this.prisma.notification.create({
        data: {
          organizationId,
          recipientUserId,
          type: 'FOLLOW_UP_ASSIGNED' as any,
          title,
          message,
          relatedLeadId,
          relatedFollowUpId,
          dueOccurrence,
        },
      });

      this.logger.log(
        `Created assignment notification ${notification.id} for user ${recipientUserId} (FollowUp: ${relatedFollowUpId})`,
      );

      // Emit real-time notification to user's isolated room
      try {
        this.gateway.sendNotificationToUser(organizationId, recipientUserId, notification);
      } catch (wsErr: any) {
        this.logger.warn(`Failed to send real-time socket event: ${wsErr?.message}`);
      }

      return notification;
    } catch (err: any) {
      if (err.code === 'P2002') {
        this.logger.debug(
          `Assignment notification already exists for followUp ${relatedFollowUpId}`,
        );
        return null;
      }
      this.logger.error(`Error creating assignment notification: ${err?.message}`, err?.stack);
      return null;
    }
  }

  /**
   * Retrieves paginated notifications strictly for the authenticated user within their organization.
   */
  async getUserNotifications(
    organizationId: string,
    recipientUserId: string,
    dto: QueryNotificationsDto,
  ) {
    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      organizationId,
      recipientUserId,
    };

    if (dto.unreadOnly) {
      where.isRead = false;
    }

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { organizationId, recipientUserId, isRead: false },
      }),
    ]);

    return {
      data: items,
      meta: {
        total,
        unreadCount,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves unread notification count for authenticated user.
   */
  async getUnreadCount(organizationId: string, recipientUserId: string) {
    const unreadCount = await this.prisma.notification.count({
      where: {
        organizationId,
        recipientUserId,
        isRead: false,
      },
    });

    return { unreadCount };
  }

  /**
   * Marks a single notification as read for authenticated user.
   */
  async markAsRead(
    organizationId: string,
    recipientUserId: string,
    notificationId: string,
  ) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        organizationId,
        recipientUserId,
      },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID "${notificationId}" not found`);
    }

    if (notification.isRead) {
      return notification;
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * Marks all unread notifications as read for authenticated user.
   */
  async markAllAsRead(organizationId: string, recipientUserId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        organizationId,
        recipientUserId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { updatedCount: result.count };
  }
}

