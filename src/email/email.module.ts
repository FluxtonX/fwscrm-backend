import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service';
import { DevEmailProvider } from './providers/dev-email.provider';
import { BrevoEmailProvider } from './providers/brevo-email.provider';

@Module({
  imports: [ConfigModule],
  providers: [EmailService, DevEmailProvider, BrevoEmailProvider],
  exports: [EmailService],
})
export class EmailModule {}
