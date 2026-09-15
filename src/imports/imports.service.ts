import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Import, ImportError, ImportStatus, Prisma } from '@prisma/client';
import * as xlsx from 'xlsx';

export interface CrmFieldDefinition {
  key: string;
  label: string;
  required: boolean;
  description: string;
}

export const AVAILABLE_CRM_FIELDS: CrmFieldDefinition[] = [
  {
    key: 'firstName',
    label: 'First Name',
    required: true,
    description: 'Given name',
  },
  {
    key: 'lastName',
    label: 'Last Name',
    required: true,
    description: 'Family name',
  },
  {
    key: 'email',
    label: 'Email',
    required: true,
    description: 'Primary email address',
  },
  {
    key: 'phone',
    label: 'Phone',
    required: false,
    description: 'Direct or mobile telephone',
  },
  {
    key: 'country',
    label: 'Country',
    required: false,
    description: 'Country name or ISO code',
  },
  {
    key: 'leadSource',
    label: 'Lead Source',
    required: false,
    description: 'Acquisition / marketing channel',
  },
  {
    key: 'referrer',
    label: 'Referrer',
    required: false,
    description: 'Referring agent or domain',
  },
  {
    key: 'tag1',
    label: 'Tag',
    required: false,
    description: 'Lead categorization tag',
  },
  {
    key: 'owner',
    label: 'Owner / Assigned Rep',
    required: false,
    description: 'Assigned team member (name, email, or user ID)',
  },
];

export function suggestMappingForHeaders(
  headers: string[],
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const matchedCrmFields = new Set<string>();

  for (const header of headers) {
    const clean = header
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
    let matchedKey: string | null = null;

    if (['firstname', 'fname', 'first', 'givenname'].includes(clean)) {
      matchedKey = 'firstName';
    } else if (
      ['lastname', 'lname', 'last', 'surname', 'familyname'].includes(clean)
    ) {
      matchedKey = 'lastName';
    } else if (['name', 'fullname', 'contactname'].includes(clean)) {
      matchedKey = 'firstName';
    } else if (
      ['email', 'emailaddress', 'mail', 'primaryemail', 'e-mail'].includes(
        clean,
      )
    ) {
      matchedKey = 'email';
    } else if (
      [
        'phone',
        'phonenumber',
        'telephone',
        'mobile',
        'mobilephone',
        'cell',
        'cellphone',
        'contactnumber',
      ].includes(clean)
    ) {
      matchedKey = 'phone';
    } else if (
      ['country', 'nation', 'countrycode', 'countryname', 'location'].includes(
        clean,
      )
    ) {
      matchedKey = 'country';
    } else if (
      [
        'leadsource',
        'source',
        'channel',
        'leadorigin',
        'acquisitionchannel',
      ].includes(clean)
    ) {
      matchedKey = 'leadSource';
    } else if (['referrer', 'referredby', 'ref'].includes(clean)) {
      matchedKey = 'referrer';
    } else if (['tag', 'tags', 'tag1', 'leadtag', 'lead_tag'].includes(clean)) {
      matchedKey = 'tag1';
    } else if (
      [
        'owner',
        'assignedto',
        'assignedrep',
        'salesrep',
        'leadowner',
        'rep',
      ].includes(clean)
    ) {
      matchedKey = 'owner';
    }

    if (matchedKey && !matchedCrmFields.has(matchedKey)) {
      mapping[header] = matchedKey;
      matchedCrmFields.add(matchedKey);
    }
  }

  return mapping;
}

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

  parsePreview(buffer: Buffer, originalname: string) {
    try {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new BadRequestException(
          'The uploaded file does not contain any sheets',
        );
      }

      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = xlsx.utils.sheet_to_json(worksheet, {
        header: 1,
        blankrows: false,
        defval: '',
      }) as (string | number)[][];

      if (!rawRows || rawRows.length === 0) {
        throw new BadRequestException('The uploaded file is empty');
      }

      // Detect if row 0 looks like a header
      const firstRow = rawRows[0];
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const looksLikeData = firstRow.some((cell) => {
        const str = String(cell).trim();
        return emailRegex.test(str) || (!isNaN(Number(str)) && str.length > 3);
      });

      const detectedHasHeader = !looksLikeData;
      let headers: string[] = [];
      let sampleRows: Record<string, string>[] = [];

      if (detectedHasHeader) {
        headers = firstRow.map((cell, idx) => {
          const val = String(cell ?? '').trim();
          return val.length > 0 ? val : `Column ${idx + 1}`;
        });
        sampleRows = rawRows.slice(1, 11).map((row) => {
          const rowObj: Record<string, string> = {};
          headers.forEach((header, idx) => {
            rowObj[header] =
              row[idx] !== undefined && row[idx] !== null
                ? String(row[idx]).trim()
                : '';
          });
          return rowObj;
        });
      } else {
        const maxCols = Math.max(
          ...rawRows.slice(0, 10).map((r) => r.length),
          1,
        );
        headers = Array.from(
          { length: maxCols },
          (_, idx) => `Column ${idx + 1}`,
        );
        sampleRows = rawRows.slice(0, 10).map((row) => {
          const rowObj: Record<string, string> = {};
          headers.forEach((header, idx) => {
            rowObj[header] =
              row[idx] !== undefined && row[idx] !== null
                ? String(row[idx]).trim()
                : '';
          });
          return rowObj;
        });
      }

      const suggestedMapping = suggestMappingForHeaders(headers);

      return {
        headers,
        detectedHasHeader,
        totalDetectedRows: detectedHasHeader
          ? Math.max(0, rawRows.length - 1)
          : rawRows.length,
        sampleRows,
        suggestedMapping,
        availableFields: AVAILABLE_CRM_FIELDS,
      };
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException(
        `Failed to parse spreadsheet preview: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async createImport(
    organizationId: string,
    fileName: string,
    fileSize: number,
    userId?: string,
  ): Promise<Import> {
    return this.prisma.import.create({
      data: {
        organizationId,
        fileName,
        fileSize,
        userId,
        status: ImportStatus.QUEUED,
      },
    });
  }

  async getImportById(
    organizationId: string,
    id: string,
  ): Promise<Import & { errors: ImportError[] }> {
    const importRecord = await this.prisma.import.findFirst({
      where: { id, organizationId },
      include: {
        errors: {
          take: 50,
          orderBy: { rowNumber: 'asc' },
        },
      },
    });

    if (!importRecord) {
      throw new NotFoundException(`Import record "${id}" not found`);
    }

    return importRecord;
  }

  async listImports(organizationId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [total, data] = await Promise.all([
      this.prisma.import.count({ where: { organizationId } }),
      this.prisma.import.findMany({
        where: { organizationId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async updateProgress(
    id: string,
    data: Prisma.ImportUpdateInput,
  ): Promise<Import> {
    return this.prisma.import.update({
      where: { id },
      data,
    });
  }

  async recordError(
    importId: string,
    rowNumber: number,
    field: string | undefined,
    reason: string,
    rawData?: Record<string, unknown>,
  ): Promise<ImportError> {
    return this.prisma.importError.create({
      data: {
        importId,
        rowNumber,
        field,
        reason,
        rawData: rawData as Prisma.InputJsonValue,
      },
    });
  }
}
