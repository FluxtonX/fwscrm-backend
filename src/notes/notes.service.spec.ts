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
        user: { firstName: 'John', lastName: 'Doe' },
      });

      const result = await service.create('org-1', 'lead-1', 'user-1', {
        content: 'Test note',
      });

      expect(result.id).toBe('note-1');
      expect(mockActivities.logActivity).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should throw ForbiddenException if regular agent tries to delete another user note', async () => {
      mockPrisma.leadNote.findFirst.mockResolvedValue({
        id: 'note-1',
        userId: 'user-other',
        leadId: 'lead-1',
      });

      await expect(
        service.delete('org-1', 'note-1', 'user-1', Role.AGENT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow note author to delete own note', async () => {
      mockPrisma.leadNote.findFirst.mockResolvedValue({
        id: 'note-1',
        userId: 'user-1',
        leadId: 'lead-1',
      });
      mockPrisma.leadNote.delete.mockResolvedValue({ id: 'note-1' });

      const result = await service.delete(
        'org-1',
        'note-1',
        'user-1',
        Role.AGENT,
      );
      expect(result.success).toBe(true);
    });

    it('should allow admin to delete any note', async () => {
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
        Role.ADMIN,
      );
      expect(result.success).toBe(true);
    });
  });
});
