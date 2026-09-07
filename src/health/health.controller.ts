import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let databaseStatus = 'unknown';

    if (process.env.DATABASE_URL) {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        databaseStatus = 'connected';
      } catch {
        databaseStatus = 'disconnected';
      }
    } else {
      databaseStatus = 'not_configured';
    }

    return {
      status: databaseStatus === 'disconnected' ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database: databaseStatus,
      },
    };
  }
}
