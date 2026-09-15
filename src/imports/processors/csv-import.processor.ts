import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  ImportStatus,
  ActivityType,
  Country,
  LeadSource,
} from '@prisma/client';
import * as csvParser from 'csv-parser';
import * as xlsx from 'xlsx';

interface CsvRow {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  country?: string;
  leadSource?: string;
  referrer?: string;
  tag1?: string;
  owner?: string;
  [key: string]: string | undefined;
}

@Injectable()
export class CsvImportProcessor {
  private readonly logger = new Logger(CsvImportProcessor.name);
  private readonly batchSize = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private mapRow(
    rawObj: Record<string, any>,
    mapping?: Record<string, string>,
    hasHeader = true,
  ): CsvRow {
    const ALLOWED_CRM_KEYS = new Set([
      'firstName',
      'lastName',
      'email',
      'phone',
      'country',
      'leadSource',
      'referrer',
      'tag1',
      'owner',
    ]);

    const mappedRow: CsvRow = {};

    if (mapping && Object.keys(mapping).length > 0) {
      for (const [sourceCol, targetField] of Object.entries(mapping)) {
        if (
          !targetField ||
          targetField === 'DO_NOT_IMPORT' ||
          !ALLOWED_CRM_KEYS.has(targetField)
        ) {
          continue;
        }

        let val: any = rawObj[sourceCol];
        if (val === undefined) {
          const found = Object.keys(rawObj).find(
            (k) => k.trim().toLowerCase() === sourceCol.trim().toLowerCase(),
          );
          if (found) val = rawObj[found];
        }

        if (val === undefined && sourceCol.toLowerCase().startsWith('column')) {
          const colNum = parseInt(sourceCol.replace(/column\s*/i, ''), 10);
          if (!isNaN(colNum)) {
            const zeroIndex = colNum - 1;
            val = rawObj[zeroIndex] ?? rawObj[String(zeroIndex)];
          }
        }

        if (val === undefined && !isNaN(Number(sourceCol))) {
          val = rawObj[Number(sourceCol)] ?? rawObj[sourceCol];
        }

        if (val !== undefined && val !== null) {
          mappedRow[targetField] = String(val).trim();
        }
      }
    } else {
      // Fallback auto-detection for backward compatibility
      for (const [key, val] of Object.entries(rawObj)) {
        if (val === undefined || val === null) continue;
        const clean = key
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, '');
        const strVal = String(val).trim();

        if (['firstname', 'fname', 'first', 'givenname'].includes(clean)) {
          mappedRow.firstName = strVal;
        } else if (
          ['lastname', 'lname', 'last', 'surname', 'familyname'].includes(clean)
        ) {
          mappedRow.lastName = strVal;
        } else if (['name', 'fullname', 'contactname'].includes(clean)) {
          mappedRow.firstName = strVal;
        } else if (
          ['email', 'emailaddress', 'mail', 'primaryemail', 'e-mail'].includes(
            clean,
          )
        ) {
          mappedRow.email = strVal;
        } else if (
          [
            'phone',
            'phonenumber',
            'telephone',
            'mobile',
            'cell',
            'contactnumber',
          ].includes(clean)
        ) {
          mappedRow.phone = strVal;
        } else if (
          [
            'country',
            'nation',
            'countrycode',
            'countryname',
            'location',
          ].includes(clean)
        ) {
          mappedRow.country = strVal;
        } else if (
          ['leadsource', 'source', 'channel', 'leadorigin'].includes(clean)
        ) {
          mappedRow.leadSource = strVal;
        } else if (['referrer', 'referredby', 'ref'].includes(clean)) {
          mappedRow.referrer = strVal;
        } else if (
          ['tag', 'tags', 'tag1', 'leadtag', 'lead_tag'].includes(clean)
        ) {
          mappedRow.tag1 = strVal;
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
          mappedRow.owner = strVal;
        }
      }
    }

    // Name splitting fallback if single name provided and lastName is missing
    if (mappedRow.firstName && !mappedRow.lastName) {
      const parts = mappedRow.firstName.split(/\s+/);
      if (parts.length > 1) {
        mappedRow.firstName = parts[0];
        mappedRow.lastName = parts.slice(1).join(' ');
      } else {
        mappedRow.lastName = '-';
      }
    }

    return mappedRow;
  }

  async processImport(
    importId: string,
    storageKey: string,
    organizationId: string,
    mapping?: Record<string, string>,
    hasHeader = true,
    defaultOwnerId?: string,
  ): Promise<void> {
    this.logger.log(`Starting background processing for import ${importId}`);

    await this.prisma.import.update({
      where: { id: importId },
      data: {
        status: ImportStatus.PROCESSING,
        startedAt: new Date(),
      },
    });

    let totalRows = 0;
    let importedRows = 0;
    let duplicateRows = 0;
    let invalidRows = 0;
    let failedRows = 0;

    let rowBuffer: { rowNumber: number; data: CsvRow }[] = [];

    try {
      // Pre-load country and lead source maps
      const countries = await this.prisma.country.findMany();
      const countryMap = new Map(
        countries.map((c) => [c.name.toLowerCase(), c]),
      );

      const sources = await this.prisma.leadSource.findMany({
        where: { organizationId },
      });
      const sourceMap = new Map(sources.map((s) => [s.name.toLowerCase(), s]));

      // Pre-load active users in organization for owner resolution (by id, email, full name)
      const orgUsers = await this.prisma.user.findMany({
        where: { organizationId, isActive: true },
        select: { id: true, email: true, firstName: true, lastName: true },
      });
      const userById = new Map<string, string>();
      const userByEmail = new Map<string, string>();
      const userByName = new Map<string, string>();

      for (const u of orgUsers) {
        userById.set(u.id, u.id);
        if (u.email) {
          userByEmail.set(u.email.trim().toLowerCase(), u.id);
        }
        const fullName = `${u.firstName || ''} ${u.lastName || ''}`
          .trim()
          .toLowerCase();
        if (fullName) {
          userByName.set(fullName, u.id);
        }
      }

      const defaultStatus = await this.prisma.leadStatus.findFirst({
        where: { organizationId, isDefault: true },
      });

      const filePath = this.storage.getFilePath(storageKey);
      const isXlsx = !!filePath.match(/\.(xlsx|xls)$/i);

      if (isXlsx) {
        // Parse XLSX using SheetJS
        const workbook = xlsx.readFile(filePath, {
          cellDates: true,
          dense: true,
        });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawGrid = xlsx.utils.sheet_to_json(worksheet, {
          header: 1,
          blankrows: false,
          defval: '',
        }) as (string | number)[][];

        let headers: string[] = [];
        let dataRows: (string | number)[][] = [];

        if (hasHeader && rawGrid.length > 0) {
          headers = rawGrid[0].map((cell, idx) => {
            const val = String(cell ?? '').trim();
            return val || `Column ${idx + 1}`;
          });
          dataRows = rawGrid.slice(1);
        } else {
          const maxCols = Math.max(
            ...rawGrid.slice(0, 10).map((r) => r.length),
            1,
          );
          headers = Array.from(
            { length: maxCols },
            (_, idx) => `Column ${idx + 1}`,
          );
          dataRows = rawGrid;
        }

        for (const rowArr of dataRows) {
          totalRows++;
          const rawObj: Record<string, string> = {};
          headers.forEach((h, idx) => {
            const val =
              rowArr[idx] !== undefined && rowArr[idx] !== null
                ? String(rowArr[idx]).trim()
                : '';
            rawObj[h] = val;
            rawObj[String(idx)] = val;
          });

          const mappedData = this.mapRow(rawObj, mapping, hasHeader);
          rowBuffer.push({ rowNumber: totalRows, data: mappedData });

          if (rowBuffer.length >= this.batchSize) {
            const batchResult = await this.processBatch(
              rowBuffer,
              organizationId,
              importId,
              countryMap,
              sourceMap,
              userById,
              userByEmail,
              userByName,
              defaultStatus?.id,
              defaultOwnerId,
            );
            importedRows += batchResult.imported;
            duplicateRows += batchResult.duplicates;
            invalidRows += batchResult.invalid;
            failedRows += batchResult.failed;

            await this.prisma.import.update({
              where: { id: importId },
              data: {
                totalRows,
                processedRows: totalRows,
                importedRows,
                duplicateRows,
                invalidRows,
                failedRows,
              },
            });

            rowBuffer = [];
          }
        }
      } else {
        // Stream CSV using csv-parser
        const stream = await this.storage.getFileStream(storageKey);
        const parser = stream.pipe(
          csvParser(hasHeader ? {} : { headers: false }),
        );

        for await (const rawRow of parser) {
          totalRows++;
          const mappedData = this.mapRow(rawRow, mapping, hasHeader);
          rowBuffer.push({ rowNumber: totalRows, data: mappedData });

          if (rowBuffer.length >= this.batchSize) {
            const batchResult = await this.processBatch(
              rowBuffer,
              organizationId,
              importId,
              countryMap,
              sourceMap,
              userById,
              userByEmail,
              userByName,
              defaultStatus?.id,
              defaultOwnerId,
            );
            importedRows += batchResult.imported;
            duplicateRows += batchResult.duplicates;
            invalidRows += batchResult.invalid;
            failedRows += batchResult.failed;

            await this.prisma.import.update({
              where: { id: importId },
              data: {
                totalRows,
                processedRows: totalRows,
                importedRows,
                duplicateRows,
                invalidRows,
                failedRows,
              },
            });

            rowBuffer = [];
          }
        }
      }

      // Process trailing rows in buffer
      if (rowBuffer.length > 0) {
        const batchResult = await this.processBatch(
          rowBuffer,
          organizationId,
          importId,
          countryMap,
          sourceMap,
          userById,
          userByEmail,
          userByName,
          defaultStatus?.id,
          defaultOwnerId,
        );
        importedRows += batchResult.imported;
        duplicateRows += batchResult.duplicates;
        invalidRows += batchResult.invalid;
        failedRows += batchResult.failed;
      }

      const finalStatus =
        invalidRows > 0 || failedRows > 0
          ? ImportStatus.COMPLETED_WITH_ERRORS
          : ImportStatus.COMPLETED;

      await this.prisma.import.update({
        where: { id: importId },
        data: {
          status: finalStatus,
          totalRows,
          processedRows: totalRows,
          importedRows,
          duplicateRows,
          invalidRows,
          failedRows,
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `Import ${importId} finished: ${importedRows} imported, ${duplicateRows} duplicates, ${invalidRows} invalid. Status: ${finalStatus}`,
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Import ${importId} fatal failure: ${errMsg}`);

      await this.prisma.import.update({
        where: { id: importId },
        data: {
          status: ImportStatus.FAILED,
          completedAt: new Date(),
        },
      });
    }
  }

  private async processBatch(
    rows: { rowNumber: number; data: CsvRow }[],
    organizationId: string,
    importId: string,
    countryMap: Map<string, Country>,
    sourceMap: Map<string, LeadSource>,
    userById: Map<string, string>,
    userByEmail: Map<string, string>,
    userByName: Map<string, string>,
    defaultStatusId?: string,
    defaultOwnerId?: string,
  ) {
    let imported = 0;
    let duplicates = 0;
    let invalid = 0;
    let failed = 0;

    const validRows: {
      rowNumber: number;
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      countryId?: string;
      countryName?: string;
      sourceId?: string;
      sourceName?: string;
      referrer?: string;
      tag1?: string;
      ownerId?: string;
    }[] = [];

    // 1. Row Validation
    for (const item of rows) {
      const { rowNumber, data } = item;
      let firstName = data.firstName?.trim();
      let lastName = data.lastName?.trim();
      const email = data.email?.trim().toLowerCase();

      // Split full name if only firstName was mapped/provided
      if (firstName && !lastName) {
        const parts = firstName.split(/\s+/);
        if (parts.length > 1) {
          firstName = parts[0];
          lastName = parts.slice(1).join(' ');
        } else {
          lastName = '-';
        }
      }

      if (!firstName || !lastName || !email) {
        invalid++;
        await this.recordError(
          importId,
          rowNumber,
          !email ? 'email' : !firstName ? 'firstName' : 'lastName',
          'First Name, Last Name, and Email are required',
          data,
        );
        continue;
      }

      // Email format check
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        invalid++;
        await this.recordError(
          importId,
          rowNumber,
          'email',
          `Invalid email address format: "${email}"`,
          data,
        );
        continue;
      }

      // Resolve Country
      let countryId: string | undefined = undefined;
      let countryName = data.country?.trim() || undefined;
      if (countryName) {
        const existingCountry = countryMap.get(countryName.toLowerCase());
        if (existingCountry) {
          countryId = existingCountry.id;
          countryName = existingCountry.name;
        }
      }

      // Resolve Lead Source
      let sourceId: string | undefined = undefined;
      let sourceName = data.leadSource?.trim() || undefined;
      if (sourceName) {
        const existingSource = sourceMap.get(sourceName.toLowerCase());
        if (existingSource) {
          sourceId = existingSource.id;
          sourceName = existingSource.name;
        }
      }

      // Resolve Owner (Priority: File mapped owner -> defaultOwnerId -> unassigned)
      let ownerId: string | undefined = undefined;
      const rawOwner = data.owner?.trim();
      if (rawOwner) {
        const rawOwnerLower = rawOwner.toLowerCase();
        if (userById.has(rawOwner)) {
          ownerId = userById.get(rawOwner);
        } else if (userByEmail.has(rawOwnerLower)) {
          ownerId = userByEmail.get(rawOwnerLower);
        } else if (userByName.has(rawOwnerLower)) {
          ownerId = userByName.get(rawOwnerLower);
        }
      }
      if (!ownerId && defaultOwnerId) {
        ownerId = defaultOwnerId;
      }

      validRows.push({
        rowNumber,
        firstName,
        lastName,
        email,
        phone: data.phone?.trim() || undefined,
        countryId,
        countryName,
        sourceId,
        sourceName,
        referrer: data.referrer?.trim() || undefined,
        tag1: data.tag1?.trim() || undefined,
        ownerId,
      });
    }

    if (validRows.length === 0) {
      return { imported, duplicates, invalid, failed };
    }

    // 2. Batch Duplicate Detection per Organization
    const candidateEmails = validRows.map((r) => r.email);
    const existingLeads = await this.prisma.lead.findMany({
      where: {
        organizationId,
        email: { in: candidateEmails },
      },
      select: { email: true },
    });

    const existingEmailSet = new Set(
      existingLeads.map((l) => l.email.toLowerCase()),
    );

    const nonDuplicateRows = validRows.filter((r) => {
      if (existingEmailSet.has(r.email)) {
        duplicates++;
        return false;
      }
      return true;
    });

    // 3. Batch Insertion via transaction
    if (nonDuplicateRows.length > 0) {
      try {
        await this.prisma.$transaction(
          nonDuplicateRows.map((row) =>
            this.prisma.lead.create({
              data: {
                organizationId,
                firstName: row.firstName,
                lastName: row.lastName,
                email: row.email,
                phone: row.phone,
                countryId: row.countryId,
                countryName: row.countryName,
                sourceId: row.sourceId,
                sourceName: row.sourceName,
                referrer: row.referrer,
                tag1: row.tag1,
                ownerId: row.ownerId,
                statusId: defaultStatusId,
                activities: {
                  create: {
                    organizationId,
                    type: ActivityType.IMPORTED,
                    description: `Imported via CSV batch (Row ${row.rowNumber})`,
                  },
                },
              },
            }),
          ),
        );
        imported += nonDuplicateRows.length;
      } catch (err: unknown) {
        failed += nonDuplicateRows.length;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Batch insert error: ${msg}`);
      }
    }

    return { imported, duplicates, invalid, failed };
  }

  private async recordError(
    importId: string,
    rowNumber: number,
    field: string,
    reason: string,
    rawData: Record<string, unknown>,
  ) {
    try {
      const allowedKeys = [
        'firstName',
        'lastName',
        'email',
        'phone',
        'country',
        'leadSource',
        'referrer',
        'tag1',
        'owner',
      ];
      const sanitized: Record<string, string> = {};
      if (rawData && typeof rawData === 'object') {
        for (const k of allowedKeys) {
          if (rawData[k] !== undefined && rawData[k] !== null) {
            sanitized[k] = String(rawData[k]);
          }
        }
      }

      await this.prisma.importError.create({
        data: {
          importId,
          rowNumber,
          field,
          reason,
          rawData: JSON.stringify(sanitized),
        },
      });
    } catch {
      // Prevent error recording failure from halting the entire stream
    }
  }
}
