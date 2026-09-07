import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Import, ImportError, ImportStatus, Prisma } from '@prisma/client';

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

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
