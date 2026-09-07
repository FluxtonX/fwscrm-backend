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

interface CsvRow {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  country?: string;
  leadSource?: string;
  referrer?: string;
  tag1?: string;
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

  async processImport(
    importId: string,
    storageKey: string,
    organizationId: string,
  ): Promise<void> {
    this.logger.log(
      `Starting background CSV processing for import ${importId}`,
    );

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
      const stream = await this.storage.getFileStream(storageKey);

      // Pre-load country and lead source maps to minimize queries during ingestion
      const countries = await this.prisma.country.findMany();
      const countryMap = new Map(
        countries.map((c) => [c.name.toLowerCase(), c]),
      );

      const sources = await this.prisma.leadSource.findMany({
        where: { organizationId },
      });
      const sourceMap = new Map(sources.map((s) => [s.name.toLowerCase(), s]));

      const defaultStatus = await this.prisma.leadStatus.findFirst({
        where: { organizationId, isDefault: true },
      });

      const parser = stream.pipe(
        csvParser({
          mapHeaders: ({ header }) => {
            const clean = header.trim().toLowerCase();
            if (clean === 'first name') return 'firstName';
            if (clean === 'last name') return 'lastName';
            if (clean === 'email') return 'email';
            if (clean === 'phone') return 'phone';
            if (clean === 'country') return 'country';
            if (clean === 'lead source') return 'leadSource';
            if (clean === 'referrer') return 'referrer';
            if (clean === 'tag1') return 'tag1';
            return clean;
          },
        }),
      );

      for await (const rawRow of parser) {
        totalRows++;
        rowBuffer.push({ rowNumber: totalRows, data: rawRow });

        if (rowBuffer.length >= this.batchSize) {
          const batchResult = await this.processBatch(
            rowBuffer,
            organizationId,
            importId,
            countryMap,
            sourceMap,
            defaultStatus?.id,
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

      // Process trailing rows in buffer
      if (rowBuffer.length > 0) {
        const batchResult = await this.processBatch(
          rowBuffer,
          organizationId,
          importId,
          countryMap,
          sourceMap,
          defaultStatus?.id,
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
    defaultStatusId?: string,
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
    }[] = [];

    // 1. Row Validation
    for (const item of rows) {
      const { rowNumber, data } = item;
      const firstName = data.firstName?.trim();
      const lastName = data.lastName?.trim();
      const email = data.email?.trim().toLowerCase();

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
      await this.prisma.importError.create({
        data: {
          importId,
          rowNumber,
          field,
          reason,
          rawData: JSON.stringify(rawData),
        },
      });
    } catch {
      // Prevent error recording failure from halting the entire stream
    }
  }
}
