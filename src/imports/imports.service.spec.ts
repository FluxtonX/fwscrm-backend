import { Test, TestingModule } from '@nestjs/testing';
import {
  ImportsService,
  suggestMappingForHeaders,
  AVAILABLE_CRM_FIELDS,
} from './imports.service';
import { PrismaService } from '../database/prisma.service';
import { BadRequestException } from '@nestjs/common';

describe('ImportsService', () => {
  let service: ImportsService;

  const mockPrisma = {
    import: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    importError: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ImportsService>(ImportsService);
  });

  describe('suggestMappingForHeaders', () => {
    it('should correctly suggest CRM fields for standard header variations', () => {
      const headers = [
        'First Name',
        'Last Name',
        'Email Address',
        'Mobile Phone',
        'Country',
        'Lead Source',
        'Random Unmapped',
      ];
      const mapping = suggestMappingForHeaders(headers);

      expect(mapping['First Name']).toBe('firstName');
      expect(mapping['Last Name']).toBe('lastName');
      expect(mapping['Email Address']).toBe('email');
      expect(mapping['Mobile Phone']).toBe('phone');
      expect(mapping['Country']).toBe('country');
      expect(mapping['Lead Source']).toBe('leadSource');
      expect(mapping['Random Unmapped']).toBeUndefined();
    });

    it('should map single Name header to firstName', () => {
      const headers = ['Name', 'Email'];
      const mapping = suggestMappingForHeaders(headers);

      expect(mapping['Name']).toBe('firstName');
      expect(mapping['Email']).toBe('email');
    });

    it('should correctly suggest owner field for owner-related headers', () => {
      expect(suggestMappingForHeaders(['Owner'])['Owner']).toBe('owner');
      expect(suggestMappingForHeaders(['Assigned To'])['Assigned To']).toBe(
        'owner',
      );
      expect(suggestMappingForHeaders(['Sales Rep'])['Sales Rep']).toBe(
        'owner',
      );
      expect(suggestMappingForHeaders(['Assigned Rep'])['Assigned Rep']).toBe(
        'owner',
      );
      expect(suggestMappingForHeaders(['Lead Owner'])['Lead Owner']).toBe(
        'owner',
      );
    });

    it('should strictly map explicit tag headers to tag1 and ignore non-tag fields like Balance', () => {
      expect(suggestMappingForHeaders(['Tag'])['Tag']).toBe('tag1');
      expect(suggestMappingForHeaders(['Tags'])['Tags']).toBe('tag1');
      expect(suggestMappingForHeaders(['Tag 1'])['Tag 1']).toBe('tag1');
      expect(suggestMappingForHeaders(['Lead Tag'])['Lead Tag']).toBe('tag1');

      const nonTagHeaders = ['Balance', 'Segment', 'Category', 'Salary'];
      const mapping = suggestMappingForHeaders(nonTagHeaders);
      expect(mapping['Balance']).toBeUndefined();
      expect(mapping['Segment']).toBeUndefined();
      expect(mapping['Category']).toBeUndefined();
      expect(mapping['Salary']).toBeUndefined();
    });
  });

  describe('parsePreview', () => {
    it('should parse a CSV buffer with headers and return preview data', () => {
      const csvContent =
        'First Name,Last Name,Email,Phone,Department\nJohn,Doe,john@example.com,+123456789,Engineering\nJane,Smith,jane@test.com,+987654321,Marketing';
      const buffer = Buffer.from(csvContent);

      const result = service.parsePreview(buffer, 'contacts.csv');

      expect(result.detectedHasHeader).toBe(true);
      expect(result.headers).toEqual([
        'First Name',
        'Last Name',
        'Email',
        'Phone',
        'Department',
      ]);
      expect(result.totalDetectedRows).toBe(2);
      expect(result.sampleRows.length).toBe(2);
      expect(result.sampleRows[0]['First Name']).toBe('John');
      expect(result.sampleRows[0]['Email']).toBe('john@example.com');
      expect(result.suggestedMapping['First Name']).toBe('firstName');
      expect(result.suggestedMapping['Email']).toBe('email');
      expect(result.suggestedMapping['Department']).toBeUndefined();
      expect(result.availableFields).toEqual(AVAILABLE_CRM_FIELDS);
    });

    it('should detect headerless CSV when row 0 contains email and numbers', () => {
      const csvContent =
        'john@example.com,123456789,Doe\njane@test.com,987654321,Smith';
      const buffer = Buffer.from(csvContent);

      const result = service.parsePreview(buffer, 'headerless.csv');

      expect(result.detectedHasHeader).toBe(false);
      expect(result.headers).toEqual(['Column 1', 'Column 2', 'Column 3']);
      expect(result.sampleRows.length).toBe(2);
      expect(result.sampleRows[0]['Column 1']).toBe('john@example.com');
    });

    it('should throw BadRequestException when file buffer is empty', () => {
      const buffer = Buffer.from('');
      expect(() => service.parsePreview(buffer, 'empty.csv')).toThrow(
        BadRequestException,
      );
    });
  });
});
