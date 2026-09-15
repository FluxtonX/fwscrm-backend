import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { RemindersController } from './reminders.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [RemindersController],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
