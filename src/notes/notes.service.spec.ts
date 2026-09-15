import { Test, TestingModule } from '@nestjs/testing';
import { NotesService } from './notes.service';
import { PrismaService } from '../database/prisma.service';
import { ActivitiesService } from '../activities/activities.service';
import { Role } from '@prisma/client';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('NotesService', () => {
  let service: NotesService;

  const mockPrisma = {
    lead: {
      findFirst: jest.fn(),
    },
    leadNote: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockActivities = {
    logActivity: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ActivitiesService, useValue: mockActivities },
      ],
    }).compile();

    service = module.get<NotesService>(NotesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should throw NotFoundException if lead does not exist in org', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);

      await expect(
        service.create('org-1', 'lead-1', 'user-1', { content: 'Test note' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create note and log activity successfully', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      mockPrisma.leadNote.create.mockResolvedValue({
        id: 'note-1',
        content: 'Test note',
        user: { firstName: 'John', lastName: 'Doe', role: 'MANAGER' },
      });

      const result = await service.create('org-1', 'lead-1', 'user-1', {
        content: 'Test note',
      });

      expect(result.id).toBe('note-1');
      expect(mockActivities.logActivity).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should throw NotFoundException if note does not exist', async () => {
      mockPrisma.leadNote.findFirst.mockResolvedValue(null);

      await expect(
        service.update('org-1', 'note-99', 'user-1', Role.MANAGER, {
          content: 'Updated note',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if OPERATOR tries to update note', async () => {
      mockPrisma.leadNote.findFirst.mockResolvedValue({
        id: 'note-1',
        userId: 'user-op',
        leadId: 'lead-1',
      });

      await expect(
        service.update('org-1', 'note-1', 'user-op', Role.OPERATOR, {
          content: 'Updated note',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow MANAGER to update note', async () => {
      mockPrisma.leadNote.findFirst.mockResolvedValue({
        id: 'note-1',
        userId: 'user-mgr',
        leadId: 'lead-1',
      });
      mockPrisma.leadNote.update.mockResolvedValue({
        id: 'note-1',
        content: 'Updated note',
        user: { firstName: 'Manager', lastName: 'User', role: 'MANAGER' },
      });

      const result = await service.update(
        'org-1',
        'note-1',
        'user-mgr',
        Role.MANAGER,
        { content: 'Updated note' },
      );
      expect(result.content).toBe('Updated note');
    });
  });

  describe('delete', () => {
    it('should throw ForbiddenException if OPERATOR tries to delete note', async () => {
      mockPrisma.leadNote.findFirst.mockResolvedValue({
        id: 'note-1',
        userId: 'user-op',
        leadId: 'lead-1',
      });

      await expect(
        service.delete('org-1', 'note-1', 'user-op', Role.OPERATOR),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow Manager to delete note', async () => {
      mockPrisma.leadNote.findFirst.mockResolvedValue({
        id: 'note-1',
        userId: 'user-other',
        leadId: 'lead-1',
      });
      mockPrisma.leadNote.delete.mockResolvedValue({ id: 'note-1' });

      const result = await service.delete(
        'org-1',
        'note-1',
        'user-mgr',
        Role.MANAGER,
      );
      expect(result.success).toBe(true);
    });

    it('should allow Super Admin to delete any note', async () => {
      mockPrisma.leadNote.findFirst.mockResolvedValue({
        id: 'note-1',
        userId: 'user-other',
        leadId: 'lead-1',
      });
      mockPrisma.leadNote.delete.mockResolvedValue({ id: 'note-1' });

      const result = await service.delete(
        'org-1',
        'note-1',
        'admin-user',
        Role.SUPER_ADMIN,
      );
      expect(result.success).toBe(true);
    });
  });
});
