import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportsService } from './imports.service';
import { CsvImportProcessor } from './processors/csv-import.processor';
import { StorageService } from './storage/storage.service';
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
  ) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    }),
  )
  async uploadCsv(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A CSV file is required for upload');
    }

    if (!file.originalname.match(/\.(csv|txt)$/i)) {
      throw new BadRequestException('Only .csv files are supported');
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

    // 3. Queue asynchronous streaming processing without blocking HTTP response
    setImmediate(() => {
      this.csvProcessor
        .processImport(importRecord.id, storageKey, user.organizationId)
        .catch((err) => {
          console.error(`Background import job failed: ${err?.message}`);
        });
    });

    return {
      importId: importRecord.id,
      fileName: importRecord.fileName,
      status: importRecord.status,
      message: 'CSV file uploaded and queued for streaming ingestion',
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
