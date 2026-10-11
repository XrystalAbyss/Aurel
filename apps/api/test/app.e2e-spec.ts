import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Aurel API End-to-End Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /api/v1/health returns 200 and matches health status contract', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(response.body).toHaveProperty('status');
    expect(['ok', 'degraded']).toContain(response.body.status);
    expect(response.body).toHaveProperty('service', 'aurel-api');
    expect(response.body).toHaveProperty('version', '1.0.0');
    expect(response.body).toHaveProperty('checks');
    expect(response.body.checks).toHaveProperty('database');
    expect(response.body.checks).toHaveProperty('uptimeSeconds');
  });

  it('GET /api/v1/unregistered-route returns RFC 7807 formatted 404 response with NOT_FOUND code', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/unregistered-route')
      .expect(404);

    expect(response.body).toHaveProperty('status', 404);
    expect(response.body).toHaveProperty('title');
    expect(response.body).toHaveProperty('detail');
    expect(response.body).toHaveProperty('instance', '/api/v1/unregistered-route');
    expect(response.body).toHaveProperty('code', 'NOT_FOUND');
    expect(response.body.code).not.toBe('INTERNAL_ERROR');
    expect(response.body).toHaveProperty('timestamp');
  });

  it('Propagates or generates x-request-id header', async () => {
    const customRequestId = 'test-trace-id-12345';
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', customRequestId)
      .expect(200);

    expect(response.headers['x-request-id']).toBe(customRequestId);
  });

  it('Verifies test database isolation (connected to aurel_test, never aurel_dev)', async () => {
    const prismaService = app.get(PrismaService);
    const dbName = await prismaService.getCurrentDatabaseName();
    expect(dbName).toBe('aurel_test');
    expect(dbName).not.toBe('aurel_dev');
  });
});
