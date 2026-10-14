import { Test, TestingModule } from '@nestjs/testing';
import { CsvImportProcessor } from './csv-import.processor';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';

describe('CsvImportProcessor', () => {
  let processor: CsvImportProcessor;

  const mockPrisma = {
    $transaction: jest.fn(),
    lead: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    import: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    importError: {
      create: jest.fn(),
    },
  };

  const mockStorage = {
    getFileStream: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CsvImportProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    processor = module.get<CsvImportProcessor>(CsvImportProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('processBatch', () => {
    it('should set sourceFile and importId on created leads during batch processing', async () => {
      const rows = [
        {
          rowNumber: 1,
          data: {
            firstName: 'Sarah',
            lastName: 'Connor',
            email: 'sarah.connor@cyberdyne.com',
            phone: '+1234567890',
          },
        },
      ];

      // No duplicates found
      mockPrisma.lead.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockImplementation(async (operations) => {
        return Promise.all(operations);
      });

      const batchResult = await (processor as any).processBatch(
        rows,
        'org-test-123',
        'import-uuid-999',
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        'status-new-id',
        undefined,
        'november_leads_clean.csv',
      );

      expect(batchResult.imported).toBe(1);
      expect(batchResult.duplicates).toBe(0);
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-test-123',
            firstName: 'Sarah',
            lastName: 'Connor',
            email: 'sarah.connor@cyberdyne.com',
            sourceFile: 'november_leads_clean.csv',
            importId: 'import-uuid-999',
            activities: expect.objectContaining({
              create: expect.objectContaining({
                description: expect.stringContaining('november_leads_clean.csv'),
              }),
            }),
          }),
        }),
      );
    });
  });
});
