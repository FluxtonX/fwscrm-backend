import { NestFactory } from '@nestjs/core';
import { ValidationPipe, RequestMethod, Logger } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Parse signed cookies
  const cookieSecret =
    process.env.COOKIE_SECRET || 'dev_cookie_secret_fallback';
  app.use(cookieParser(cookieSecret));

  // Configure CORS
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  app.enableCors({
    origin: [frontendUrl],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter for secure error handling
  app.useGlobalFilters(new AllExceptionsFilter());

  // Set API prefix, keeping /health accessible for container/cloud health probes
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`CRM Backend API running on port ${port} (API prefix: /api)`);
  logger.log(`Health check available at http://localhost:${port}/health`);
}

bootstrap();
