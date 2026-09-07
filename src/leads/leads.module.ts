import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadStatusService } from './status.service';
import { LeadSourceService } from './source.service';
import { CountryService } from './country.service';

@Module({
  controllers: [LeadsController],
  providers: [
    LeadsService,
    LeadStatusService,
    LeadSourceService,
    CountryService,
  ],
  exports: [LeadsService, LeadStatusService, LeadSourceService, CountryService],
})
export class LeadsModule {}
