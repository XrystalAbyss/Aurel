import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Identity & Registration E2E & Concurrency Tests', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  const createdTestEmails: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();
    prismaService = app.get(PrismaService);

    // Verify test database isolation
    const currentDb = await prismaService.getCurrentDatabaseName();
    expect(currentDb).toBe('aurel_test');
  });

  afterAll(async () => {
    // Targeted fixture cleanup: remove only data created by this test suite
    if (createdTestEmails.length > 0) {
      await prismaService.user.deleteMany({
        where: {
          email: {
            in: createdTestEmails,
          },
        },
      });
    }

    if (app) {
      await app.close();
    }
  });

  function generateUniqueEmail(label = 'user'): string {
    const email = `p21_${label}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}@example.com`;
    createdTestEmails.push(email.toLowerCase());
    return email;
  }

  describe('POST /api/v1/auth/register - Happy Path & Security Sanitization', () => {
    it('successfully registers a customer, returning 201 Created with sanitized public response', async () => {
      const email = generateUniqueEmail('reg');
      const payload = {
        email: `  ${email.toUpperCase()}  `,
        password: 'ValidSecurePassphrase#2026',
        fullName: '  Jane Doe  ',
        phone: '+919876543210',
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(payload)
        .expect(201);

      // Verify sanitized response schema
      expect(response.body).toHaveProperty('id');
      expect(typeof response.body.id).toBe('string');
      expect(response.body.email).toBe(email.toLowerCase());
      expect(response.body.fullName).toBe('Jane Doe');
      expect(response.body.phone).toBe('+919876543210');
      expect(response.body.isActive).toBe(true);
      expect(response.body).toHaveProperty('createdAt');
      expect(new Date(response.body.createdAt).getTime()).not.toBeNaN();

      // INVARIANT: Private/internal fields must NEVER be returned in API response
      expect(response.body.passwordHash).toBeUndefined();
      expect(response.body.role).toBeUndefined();
      expect(response.body.token).toBeUndefined();
      expect(response.body.accessToken).toBeUndefined();

      // INVARIANT: Registration must NOT issue an authenticated login session (deferred to P2.2)
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('verifies real PostgreSQL persistence, Argon2id hash storage, and default role in aurel_test', async () => {
      const email = generateUniqueEmail('db_verify');
      const plaintextPassword = 'PassphraseForDbCheck#42';

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: plaintextPassword,
          fullName: 'Database Verification User',
        })
        .expect(201);

      const userId = response.body.id;

      // Query PostgreSQL directly
      const dbUser = await prismaService.user.findUnique({
        where: { id: userId },
      });

      expect(dbUser).not.toBeNull();
      expect(dbUser?.email).toBe(email.toLowerCase());
      expect(dbUser?.fullName).toBe('Database Verification User');
      expect(dbUser?.role).toBe('CUSTOMER');
      expect(dbUser?.isActive).toBe(true);

      // Verify Argon2id hash parameters stored in database
      expect(dbUser?.passwordHash).toBeDefined();
      expect(dbUser?.passwordHash.startsWith('$argon2id$v=19$m=65536,p=4,t=3$')).toBe(true);
      expect(dbUser?.passwordHash).not.toBe(plaintextPassword);
      expect(dbUser?.passwordHash).not.toContain(plaintextPassword);
    });
  });

  describe('Email Canonicalization & Duplicate Conflict Handling', () => {
    it('returns 409 Conflict when attempting to register an identical email address', async () => {
      const email = generateUniqueEmail('dup');

      // First registration succeeds
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'PasswordOne#1234',
          fullName: 'First Customer',
        })
        .expect(201);

      // Second registration with exact same email fails with 409 Conflict
      const dupResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'PasswordTwo#5678',
          fullName: 'Second Customer',
        })
        .expect(409);

      // Verify RFC 7807 compliant error format
      expect(dupResponse.body).toHaveProperty('status', 409);
      expect(dupResponse.body).toHaveProperty('title', 'Conflict');
      expect(dupResponse.body).toHaveProperty('code', 'CONFLICT');
      expect(dupResponse.body).toHaveProperty('detail');
      expect(dupResponse.body.detail).toContain('already exists');
    });

    it('enforces case-insensitive and trimmed canonical uniqueness (e.g. USER@DOMAIN.COM vs user@domain.com)', async () => {
      const baseEmail = generateUniqueEmail('casing');

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: baseEmail.toLowerCase(),
          password: 'OriginalPassword#1',
          fullName: 'Original User',
        })
        .expect(201);

      // Registering with mixed case and whitespace
      const variantEmail = `  ${baseEmail.toUpperCase()}  `;
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: variantEmail,
          password: 'AnotherPassword#2',
          fullName: 'Variant User',
        })
        .expect(409);

      expect(response.body.status).toBe(409);
      expect(response.body.code).toBe('CONFLICT');
    });
  });

  describe('Input Validation & Defense Against Mass Assignment', () => {
    it('rejects forbidden/privileged fields like role: ADMIN with 400 Bad Request', async () => {
      const email = generateUniqueEmail('privilege_escalation');
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'ValidPassword#123',
          fullName: 'Malicious Actor',
          role: 'ADMIN',
        })
        .expect(400);

      expect(response.body.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.errors.validation).toBeDefined();
      expect(response.body.errors.validation.some((err: string) => err.includes('role'))).toBe(
        true,
      );
    });

    it('rejects client-supplied id, isActive, passwordHash, and createdAt fields', async () => {
      const email = generateUniqueEmail('mass_assign');
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'ValidPassword#123',
          fullName: 'Attacker',
          id: '00000000-0000-0000-0000-000000000000',
          isActive: false,
          passwordHash: 'injected_hash',
          createdAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(400);

      expect(response.body.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects passwords shorter than 8 characters', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: generateUniqueEmail('short_pwd'),
          password: 'short',
          fullName: 'Short Password User',
        })
        .expect(400);

      expect(response.body.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects invalid email formats', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'not-an-email',
          password: 'ValidPassword#123',
          fullName: 'Invalid Email User',
        })
        .expect(400);

      expect(response.body.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects non-object payloads such as JSON arrays', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send([{ email: 'array@example.com' }])
        .expect(400);

      expect(response.body.status).toBe(400);
    });
  });

  describe('Registration Concurrency Safety (PostgreSQL Race Condition)', () => {
    it('safely handles concurrent registrations: exactly 1 commits, all losers receive 409 Conflict', async () => {
      const racingEmail = generateUniqueEmail('race_condition');
      const concurrentAttempts = 5;

      const requests = Array.from({ length: concurrentAttempts }).map((_, index) =>
        request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            email: racingEmail,
            password: `ConcurrentPassword#${index}!`,
            fullName: `Racer ${index}`,
          }),
      );

      const responses = await Promise.all(requests);

      const successResponses = responses.filter((res) => res.status === 201);
      const conflictResponses = responses.filter((res) => res.status === 409);

      // Invariant: Exactly 1 transaction commits, all other racers receive 409 Conflict
      expect(successResponses.length).toBe(1);
      expect(conflictResponses.length).toBe(concurrentAttempts - 1);

      // Verify direct database state: exactly 1 row committed for this canonical email
      const usersInDb = await prismaService.user.findMany({
        where: { email: racingEmail.toLowerCase() },
      });
      expect(usersInDb.length).toBe(1);
    });

    it('demonstrates database uniqueness constraint authority against raw SQL collision', async () => {
      const collisionEmail = generateUniqueEmail('db_raw_collision');

      // Create initial user via Prisma
      await prismaService.user.create({
        data: {
          email: collisionEmail.toLowerCase(),
          passwordHash: '$argon2id$v=19$m=65536,p=4,t=3$dummyHash',
          fullName: 'Primary User',
        },
      });

      // Attempting direct raw SQL insert of the duplicate canonical email must be rejected by PostgreSQL
      let dbError: { code?: string } | null = null;
      try {
        await prismaService.$executeRaw`
          INSERT INTO users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
          VALUES (gen_random_uuid(), ${collisionEmail.toLowerCase()}, 'hash2', 'Duplicate User', 'CUSTOMER', true, NOW(), NOW())
        `;
      } catch (err: unknown) {
        dbError = err as { code?: string };
      }

      expect(dbError).not.toBeNull();
      // PostgreSQL unique violation error code is 23505 (P2002 in Prisma client)
      expect(JSON.stringify(dbError)).toContain('users_email_key');
    });
  });

  describe('Foundation Preservation & OpenAPI Documentation', () => {
    it('confirms existing foundation system_metadata table remains intact', async () => {
      const metadata = await prismaService.systemMetadata.findMany();
      expect(Array.isArray(metadata)).toBe(true);
    });

    it('propagates x-request-id across registration endpoints', async () => {
      const traceId = 'test-registration-trace-9999';
      const email = generateUniqueEmail('trace');

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('x-request-id', traceId)
        .send({
          email,
          password: 'TracePassword#2026',
          fullName: 'Trace User',
        })
        .expect(201);

      expect(response.headers['x-request-id']).toBe(traceId);
    });

    it('verifies OpenAPI Swagger document includes POST /api/v1/auth/register', () => {
      const swaggerConfig = new DocumentBuilder()
        .setTitle('Aurel Restaurant Commerce Platform API')
        .setVersion('1.0.0')
        .build();

      const document = SwaggerModule.createDocument(app, swaggerConfig);
      const authRegisterPath = document.paths['/api/v1/auth/register'];

      expect(authRegisterPath).toBeDefined();
      expect(authRegisterPath?.post).toBeDefined();
      expect(authRegisterPath?.post?.tags).toContain('Authentication');
      expect(authRegisterPath?.post?.responses['201']).toBeDefined();
      expect(authRegisterPath?.post?.responses['400']).toBeDefined();
      expect(authRegisterPath?.post?.responses['409']).toBeDefined();
    });
  });
});
