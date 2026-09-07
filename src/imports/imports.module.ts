import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { CsvImportProcessor } from './processors/csv-import.processor';
import { StorageService } from './storage/storage.service';

@Module({
  controllers: [ImportsController],
  providers: [ImportsService, CsvImportProcessor, StorageService],
  exports: [ImportsService, CsvImportProcessor, StorageService],
})
export class ImportsModule {}
