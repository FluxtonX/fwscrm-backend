import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportsService } from './imports.service';
import { CsvImportProcessor } from './processors/csv-import.processor';
import { StorageService } from './storage/storage.service';
import { PrismaService } from '../database/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('imports')
export class ImportsController {
  constructor(
    private readonly importsService: ImportsService,
    private readonly csvProcessor: CsvImportProcessor,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('preview')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    }),
  )
  async previewFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('A spreadsheet file (.csv or .xlsx) is required for preview');
    }

    if (!file.originalname.match(/\.(csv|tsv|txt|xlsx|xls)$/i)) {
      throw new BadRequestException('Only .csv and .xlsx files are supported');
    }

    return this.importsService.parsePreview(file.buffer, file.originalname);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    }),
  )
  async uploadFile(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('mapping') mappingRaw?: string | Record<string, string>,
    @Body('hasHeader') hasHeaderRaw?: string | boolean,
    @Body('ownerId') ownerIdRaw?: string,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required for upload');
    }

    if (!file.originalname.match(/\.(csv|tsv|txt|xlsx|xls)$/i)) {
      throw new BadRequestException('Only .csv and .xlsx files are supported');
    }

    let mapping: Record<string, string> | undefined = undefined;
    if (typeof mappingRaw === 'string' && mappingRaw.trim()) {
      try {
        mapping = JSON.parse(mappingRaw);
      } catch {
        throw new BadRequestException('Invalid JSON provided for column mapping');
      }
    } else if (typeof mappingRaw === 'object' && mappingRaw !== null) {
      mapping = mappingRaw;
    }

    const hasHeader = hasHeaderRaw === false || hasHeaderRaw === 'false' ? false : true;

    // Validate ownerId server-side against the user's organization
    let validatedOwnerId: string | undefined = undefined;
    if (ownerIdRaw && typeof ownerIdRaw === 'string' && ownerIdRaw.trim() && ownerIdRaw.trim() !== 'unassigned') {
      const targetUser = await this.prisma.user.findFirst({
        where: {
          id: ownerIdRaw.trim(),
          organizationId: user.organizationId,
          isActive: true,
        },
      });
      if (!targetUser) {
        throw new BadRequestException('Selected owner is not an active team member in your organization');
      }
      validatedOwnerId = targetUser.id;
    }

    // 1. Save file to abstracted storage
    const storageKey = await this.storage.saveFile(
      file.originalname,
      file.buffer,
    );

    // 2. Create Import record in database with QUEUED status
    const importRecord = await this.importsService.createImport(
      user.organizationId,
      file.originalname,
      file.size,
      user.id,
    );

    // 3. Queue asynchronous processing without blocking HTTP response
    setImmediate(() => {
      this.csvProcessor
        .processImport(
          importRecord.id,
          storageKey,
          user.organizationId,
          mapping,
          hasHeader,
          validatedOwnerId,
        )
        .catch((err) => {
          console.error(`Background import job failed: ${err?.message}`);
        });
    });

    return {
      importId: importRecord.id,
      fileName: importRecord.fileName,
      status: importRecord.status,
      message: 'File uploaded and queued for ingestion',
    };
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT)
  async listImports(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.importsService.listImports(
      user.organizationId,
      pageNum,
      limitNum,
    );
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.AGENT)
  async getImport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.importsService.getImportById(user.organizationId, id);
  }
}
