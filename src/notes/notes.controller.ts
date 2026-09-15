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
import { NotesService } from './notes.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/permissions/permissions.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads/:leadId/notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Post()
  @RequirePermissions(Permission.NOTE_CREATE)
  createNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId') leadId: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.notesService.create(user.organizationId, leadId, user.id, dto);
  }

  @Get()
  @RequirePermissions(Permission.LEAD_VIEW)
  getNotes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId') leadId: string,
  ) {
    return this.notesService.findByLead(user.organizationId, leadId);
  }

  @Patch(':noteId')
  @RequirePermissions(Permission.NOTE_EDIT)
  updateNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('noteId') noteId: string,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.notesService.update(
      user.organizationId,
      noteId,
      user.id,
      user.role,
      dto,
    );
  }

  @Delete(':noteId')
  @RequirePermissions(Permission.NOTE_DELETE)
  deleteNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('noteId') noteId: string,
  ) {
    return this.notesService.delete(
      user.organizationId,
      noteId,
      user.id,
      user.role,
    );
  }
}
