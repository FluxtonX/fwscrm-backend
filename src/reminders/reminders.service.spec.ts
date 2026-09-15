import { Test, TestingModule } from '@nestjs/testing';
import { RemindersService } from './reminders.service';
import { PrismaService } from '../database/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('RemindersService', () => {
  let service: RemindersService;

  const mockPrisma = {
    lead: {
      findFirst: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    leadReminder: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    leadActivity: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemindersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<RemindersService>(RemindersService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should throw NotFoundException if lead not found', async () => {
      mockPrisma.lead.findFirst.mockResolvedValue(null);
      await expect(
        service.create('org-1', 'lead-1', 'user-1', {
          title: 'Follow up',
          dueDate: new Date().toISOString(),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create reminder successfully and log activity', async () => {
      const dueDate = new Date();
      mockPrisma.lead.findFirst.mockResolvedValue({ id: 'lead-1' });
      mockPrisma.leadReminder.create.mockResolvedValue({
        id: 'rem-1',
        title: 'Follow up',
        dueDate,
        isCompleted: false,
      });

      const result = await service.create('org-1', 'lead-1', 'user-1', {
        title: 'Follow up',
        dueDate: dueDate.toISOString(),
      });
      expect(result.id).toBe('rem-1');
      expect(result.status).toBe('DUE_TODAY');
      expect(mockPrisma.leadActivity.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('should toggle isCompleted on reminder and log completion', async () => {
      const dueDate = new Date();
      mockPrisma.leadReminder.findFirst.mockResolvedValue({
        id: 'rem-1',
        organizationId: 'org-1',
        leadId: 'lead-1',
        title: 'Follow up call',
        dueDate,
        isCompleted: false,
      });
      mockPrisma.leadReminder.update.mockResolvedValue({
        id: 'rem-1',
        title: 'Follow up call',
        dueDate,
        isCompleted: true,
      });

      const result = await service.update('org-1', 'rem-1', 'user-1', {
        isCompleted: true,
      });
      expect(result.isCompleted).toBe(true);
      expect(result.status).toBe('COMPLETED');
      expect(mockPrisma.leadActivity.create).toHaveBeenCalled();
    });

    it('should log reschedule when dueDate changes', async () => {
      const oldDate = new Date('2026-09-01T10:00:00Z');
      const newDate = new Date('2026-09-15T15:00:00Z');
      mockPrisma.leadReminder.findFirst.mockResolvedValue({
        id: 'rem-1',
        organizationId: 'org-1',
        leadId: 'lead-1',
        title: 'Follow up',
        dueDate: oldDate,
        isCompleted: false,
      });
      mockPrisma.leadReminder.update.mockResolvedValue({
        id: 'rem-1',
        title: 'Follow up',
        dueDate: newDate,
        isCompleted: false,
      });

      const result = await service.update('org-1', 'rem-1', 'user-1', {
        dueDate: newDate.toISOString(),
      });
      expect(result.status).toBeDefined();
      expect(mockPrisma.leadActivity.create).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete reminder and log cancellation', async () => {
      mockPrisma.leadReminder.findFirst.mockResolvedValue({
        id: 'rem-1',
        organizationId: 'org-1',
        leadId: 'lead-1',
        title: 'Follow up',
        dueDate: new Date(),
        isCompleted: false,
      });
      mockPrisma.leadReminder.delete.mockResolvedValue({ id: 'rem-1' });

      const result = await service.delete('org-1', 'rem-1', 'user-1');
      expect(result.success).toBe(true);
      expect(mockPrisma.leadActivity.create).toHaveBeenCalledTimes(1);
    });
  });
});

