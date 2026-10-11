import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 4000);
  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');
  const allowedOrigins = configService
    .get<string>('CORS_ALLOWED_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  // CORS policy
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Request-Id',
      'Idempotency-Key',
      'X-CSRF-Token',
    ],
  });

  // Global routing prefix
  app.setGlobalPrefix(apiPrefix);

  // Global validation pipeline
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global exception filter for unified RFC 7807 error formatting
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Graceful shutdown hooks
  app.enableShutdownHooks();

  // OpenAPI (Swagger) documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Aurel Restaurant Commerce Platform API')
    .setDescription('Core REST API for Aurel Table Storefront and Aurel Operations Workspace')
    .setVersion('1.0.0')
    .addTag('System', 'System liveness, readiness, and metrics')
    .addTag('Authentication', 'Customer registration and identity management')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port);
  logger.log(`Aurel API running on: http://localhost:${port}/${apiPrefix}`);
  logger.log(`Swagger documentation available at: http://localhost:${port}/api/docs`);
}

bootstrap();
