import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private keepAliveTimer: NodeJS.Timeout | null = null;

  async onModuleInit() {
    try {
      if (process.env.DATABASE_URL) {
        await this.$connect();
        this.logger.log('Database connected successfully.');
        this.startKeepAlive();
      } else {
        this.logger.warn(
          'DATABASE_URL is not set. Database connection deferred.',
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Database connection error: ${message}`);
    }
  }

  private startKeepAlive() {
    // Only run keep-alive in non-test environments
    if (process.env.NODE_ENV === 'test') return;

    // Ping database every 4 minutes (240s) to keep Neon Serverless compute & pool warm (avoids 5m auto-suspend)
    this.keepAliveTimer = setInterval(async () => {
      try {
        await this.$queryRawUnsafe('SELECT 1');
      } catch {
        // Silently tolerate transient network blips
      }
    }, 4 * 60 * 1000);

    if (this.keepAliveTimer && typeof this.keepAliveTimer.unref === 'function') {
      this.keepAliveTimer.unref();
    }
  }

  async onModuleDestroy() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    await this.$disconnect();
    this.logger.log('Database disconnected.');
  }
}
