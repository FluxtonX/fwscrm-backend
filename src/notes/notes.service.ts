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
  ) {
    // Verify lead exists and belongs to the organization
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID "${leadId}" not found`);
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
          select: { id: true, firstName: true, lastName: true, email: true },
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

  async findByLead(organizationId: string, leadId: string) {
    // Verify lead exists and belongs to the organization
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID "${leadId}" not found`);
    }

    return this.prisma.leadNote.findMany({
      where: {
        organizationId,
        leadId,
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
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

    // Authorization: owner of note or Admin/Manager can delete
    const isOwner = note.userId === userId;
    const isPrivileged =
      userRole === Role.SUPER_ADMIN ||
      userRole === Role.ADMIN ||
      userRole === Role.MANAGER;

    if (!isOwner && !isPrivileged) {
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
