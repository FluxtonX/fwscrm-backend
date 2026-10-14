import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ActivitiesService } from '../activities/activities.service';
import { ActivityType, Role } from '@prisma/client';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activitiesService: ActivitiesService,
  ) {}

  async create(
    organizationId: string,
    leadId: string,
    userId: string,
    dto: CreateNoteDto,
    actor?: AuthenticatedUser,
  ) {
    // Verify lead exists and belongs to the organization
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID "${leadId}" not found`);
    }

    if (actor && (actor.role === Role.OPERATOR || actor.role === Role.AGENT)) {
      if (lead.ownerId !== actor.id) {
        throw new ForbiddenException('You can only add notes to leads assigned to you');
      }
    }

    const note = await this.prisma.leadNote.create({
      data: {
        organizationId,
        leadId,
        userId,
        content: dto.content.trim(),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    // Log activity
    await this.activitiesService.logActivity(
      organizationId,
      leadId,
      ActivityType.NOTE_ADDED,
      `Note added by ${note.user.firstName} ${note.user.lastName}`,
      userId,
      { noteId: note.id },
    );

    this.logger.log(
      `Created note ${note.id} on lead ${leadId} by user ${userId}`,
    );
    return note;
  }

  async findByLead(
    organizationId: string,
    leadId: string,
    actor?: AuthenticatedUser,
  ) {
    // Verify lead exists and belongs to the organization
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID "${leadId}" not found`);
    }

    if (actor && (actor.role === Role.OPERATOR || actor.role === Role.AGENT)) {
      if (lead.ownerId !== actor.id) {
        throw new ForbiddenException('You can only view notes for leads assigned to you');
      }
    }

    return this.prisma.leadNote.findMany({
      where: {
        organizationId,
        leadId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    organizationId: string,
    noteId: string,
    userId: string,
    userRole: Role,
    dto: UpdateNoteDto,
  ) {
    const note = await this.prisma.leadNote.findFirst({
      where: {
        id: noteId,
        organizationId, // Strict tenant check
      },
    });

    if (!note) {
      throw new NotFoundException(`Note with ID "${noteId}" not found`);
    }

    // Authorization: Operators must never edit notes (Section 4 & 8)
    const isOwner = note.userId === userId;
    const isPrivileged =
      userRole === Role.SUPER_ADMIN ||
      userRole === Role.ADMIN ||
      userRole === Role.MANAGER;

    if (userRole === Role.OPERATOR || (!isOwner && !isPrivileged)) {
      throw new ForbiddenException(
        'You do not have permission to edit this note',
      );
    }

    const updatedNote = await this.prisma.leadNote.update({
      where: { id: noteId },
      data: {
        content: dto.content.trim(),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    this.logger.log(
      `Updated note ${noteId} on lead ${note.leadId} by user ${userId}`,
    );
    return updatedNote;
  }

  async delete(
    organizationId: string,
    noteId: string,
    userId: string,
    userRole: Role,
  ) {
    const note = await this.prisma.leadNote.findFirst({
      where: {
        id: noteId,
        organizationId, // Strict tenant check
      },
    });

    if (!note) {
      throw new NotFoundException(`Note with ID "${noteId}" not found`);
    }

    // Authorization: Operators must never delete notes (Section 4 & 9)
    const isOwner = note.userId === userId;
    const isPrivileged =
      userRole === Role.SUPER_ADMIN ||
      userRole === Role.ADMIN ||
      userRole === Role.MANAGER;

    if (userRole === Role.OPERATOR || (!isOwner && !isPrivileged)) {
      throw new ForbiddenException(
        'You do not have permission to delete this note',
      );
    }

    await this.prisma.leadNote.delete({
      where: { id: noteId },
    });

    this.logger.log(`Deleted note ${noteId} from lead ${note.leadId}`);
    return { success: true };
  }
}
