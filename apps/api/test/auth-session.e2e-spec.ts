import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/identity/password.service';
import { RateLimiterService } from '../src/identity/rate-limiter.service';
import { SessionService } from '../src/identity/session.service';
import { SESSION_COOKIE_NAME_DEV, CSRF_COOKIE_NAME } from '../src/identity/cookie.config';
import { configureTrustProxy } from '../src/config/proxy.config';
import { validateEnvironment } from '../src/config/env.validation';

describe('Aurel P2.2 — Secure Authentication & Session Lifecycle E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let rateLimiter: RateLimiterService;
  let sessionService: SessionService;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());

    // Explicitly configure baseline proxy trust boundary (disabled by default)
    configureTrustProxy(app, false);

    await app.init();

    prisma = app.get(PrismaService);
    passwordService = app.get(PasswordService);
    rateLimiter = app.get(RateLimiterService);
    sessionService = app.get(SessionService);

    const currentDb = await prisma.getCurrentDatabaseName();
    expect(currentDb).toBe('aurel_test');
  });

  afterAll(async () => {
    // Cascade cleanup: deleting users also cascade-deletes their auth_sessions in PostgreSQL
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }

    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    rateLimiter.clearAll();
    rateLimiter.resetCustomLimits();
  });

  async function createTestUser(opts?: {
    email?: string;
    password?: string;
    fullName?: string;
    isActive?: boolean;
  }) {
    const email =
      opts?.email ||
      `p22_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@example.com`;
    const password = opts?.password || 'ValidSecurePassphrase#2026';
    const passwordHash = await passwordService.hash(password);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        fullName: opts?.fullName || 'Test Customer',
        isActive: opts?.isActive ?? true,
      },
    });

    createdUserIds.push(user.id);
    return { user, password, rawEmail: email };
  }

  function getCookieHeaders(res: request.Response): string[] {
    const raw = res.headers['set-cookie'];
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  function extractCookie(res: request.Response, name: string): string | undefined {
    const cookies = getCookieHeaders(res);
    for (const c of cookies) {
      if (c.startsWith(`${name}=`)) {
        return c.split(';')[0].split('=')[1];
      }
    }
    return undefined;
  }

  describe('1. Login Endpoint (POST /api/v1/auth/login)', () => {
    it('authenticates valid credentials, sets secure HttpOnly cookie and CSRF cookie, returns sanitized profile', async () => {
      const { user, password, rawEmail } = await createTestUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: `  ${rawEmail.toUpperCase()}  `, password })
        .expect(200);

      // Sanitized profile verification
      expect(res.body.id).toBe(user.id);
      expect(res.body.email).toBe(user.email);
      expect(res.body.fullName).toBe(user.fullName);
      expect(res.body.isActive).toBe(true);
      expect(res.body.passwordHash).toBeUndefined();
      expect(res.body.role).toBeUndefined();
      expect(res.body.token).toBeUndefined();
      expect(res.body.sessionToken).toBeUndefined();

      // Session Cookie Verification
      const sessionCookie = extractCookie(res, SESSION_COOKIE_NAME_DEV);
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toHaveLength(64); // 256 bits hex

      const setCookieHeaders = getCookieHeaders(res);
      const sessionCookieHeader = setCookieHeaders.find((c: string) =>
        c.startsWith(`${SESSION_COOKIE_NAME_DEV}=`),
      );
      expect(sessionCookieHeader).toContain('HttpOnly');
      expect(sessionCookieHeader).toContain('Path=/');
      expect(sessionCookieHeader).toContain('SameSite=Lax');

      // CSRF Cookie and Header Verification
      const csrfCookie = extractCookie(res, CSRF_COOKIE_NAME);
      expect(csrfCookie).toBeDefined();
      expect(res.headers['x-csrf-token']).toBe(csrfCookie);

      // Verify database persistence and token digest invariant
      const tokenDigest = sessionService.computeTokenDigest(sessionCookie!);
      const dbSession = await prisma.authSession.findUnique({
        where: { tokenDigest },
      });
      expect(dbSession).not.toBeNull();
      expect(dbSession?.userId).toBe(user.id);
      expect(dbSession?.tokenDigest).not.toBe(sessionCookie); // Raw token never in DB
    });

    it('returns generic 401 Unauthorized for incorrect password without leaking existence', async () => {
      const { rawEmail } = await createTestUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password: 'WrongPassword#999' })
        .expect(401);

      expect(res.body.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.body.detail).toBe('Invalid email or password.');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('returns generic 401 Unauthorized for unknown email address with timing dummy verification', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nonexistent_account_12345@example.com', password: 'SomePassword#123' })
        .expect(401);

      expect(res.body.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.body.detail).toBe('Invalid email or password.');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('rejects login attempt for inactive / disabled account with generic 401', async () => {
      const { password, rawEmail } = await createTestUser({ isActive: false });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(401);

      expect(res.body.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.body.detail).toBe('Invalid email or password.');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('rejects malformed payloads with 400 Bad Request via ValidationPipe', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: '' })
        .expect(400);

      expect(res.body.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('2. Current User Profile Endpoint (GET /api/v1/auth/me)', () => {
    it('returns sanitized current profile when authenticated with active session cookie', async () => {
      const { user, password, rawEmail } = await createTestUser();

      // Log in
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);

      // Call /auth/me
      const meRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}`)
        .expect(200);

      expect(meRes.body.id).toBe(user.id);
      expect(meRes.body.email).toBe(user.email);
      expect(meRes.body.fullName).toBe(user.fullName);
      expect(meRes.body.isActive).toBe(true);
      expect(meRes.body.passwordHash).toBeUndefined();
    });

    it('returns 401 Unauthorized when no cookie is sent', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);

      expect(res.body.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 Unauthorized when session token is invalid, tampered, or unknown', async () => {
      const fakeToken = 'f'.repeat(64);
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${fakeToken}`)
        .expect(401);

      expect(res.body.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 Unauthorized when session is revoked', async () => {
      const { password, rawEmail } = await createTestUser();

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const tokenDigest = sessionService.computeTokenDigest(sessionCookie!);

      // Mark session revoked directly in PostgreSQL
      await prisma.authSession.update({
        where: { tokenDigest },
        data: { revokedAt: new Date() },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}`)
        .expect(401);

      expect(res.body.status).toBe(401);
    });

    it('returns 401 Unauthorized when session is expired', async () => {
      const { password, rawEmail } = await createTestUser();

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const tokenDigest = sessionService.computeTokenDigest(sessionCookie!);

      // Backdate expiration in PostgreSQL to simulate expired session
      await prisma.authSession.update({
        where: { tokenDigest },
        data: { expiresAt: new Date(Date.now() - 10000) },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}`)
        .expect(401);

      expect(res.body.status).toBe(401);
    });

    it('returns 401 Unauthorized immediately if user account is deactivated after session creation', async () => {
      const { user, password, rawEmail } = await createTestUser();

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);

      // Deactivate user in PostgreSQL
      await prisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}`)
        .expect(401);

      expect(res.body.status).toBe(401);
    });
  });

  describe('3. Single-Session Logout (POST /api/v1/auth/logout)', () => {
    it('revokes session in PostgreSQL, clears cookies, and rejects subsequent calls', async () => {
      const { password, rawEmail } = await createTestUser();

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const csrfToken = loginRes.headers['x-csrf-token'];
      const csrfCookie = extractCookie(loginRes, CSRF_COOKIE_NAME);
      const tokenDigest = sessionService.computeTokenDigest(sessionCookie!);

      // Logout with valid session cookie, CSRF cookie, and CSRF header
      const logoutRes = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=${csrfCookie}`,
        )
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(logoutRes.body.success).toBe(true);

      // Verify cookies cleared
      const setCookieHeaders = getCookieHeaders(logoutRes);
      expect(setCookieHeaders.some((c: string) => c.includes(`${SESSION_COOKIE_NAME_DEV}=`))).toBe(
        true,
      );

      // Verify PostgreSQL session revocation
      const sessionInDb = await prisma.authSession.findUnique({
        where: { tokenDigest },
      });
      expect(sessionInDb?.revokedAt).not.toBeNull();

      // Subsequent authenticated requests using the old cookie must fail with 401
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}`)
        .expect(401);
    });

    it('rejects logout without valid CSRF token with 403 Forbidden', async () => {
      const { password, rawEmail } = await createTestUser();

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);

      // Attempt logout without CSRF token
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}`)
        .expect(403);
    });

    it('confirms repeated logout requests are safely idempotent', async () => {
      const { password, rawEmail } = await createTestUser();

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const csrfToken = loginRes.headers['x-csrf-token'];
      const csrfCookie = extractCookie(loginRes, CSRF_COOKIE_NAME);

      // First logout succeeds
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=${csrfCookie}`,
        )
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      // Second logout fails authentication with 401 because session is already revoked
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=${csrfCookie}`,
        )
        .set('X-CSRF-Token', csrfToken)
        .expect(401);
    });
  });

  describe('4. Logout-All / Global Session Revocation (POST /api/v1/auth/logout-all)', () => {
    it('revokes all active sessions for the user across multiple clients', async () => {
      const { password, rawEmail } = await createTestUser();

      // Establish Session 1 (e.g. Chrome)
      const loginRes1 = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);
      const cookie1 = extractCookie(loginRes1, SESSION_COOKIE_NAME_DEV);

      // Establish Session 2 (e.g. Mobile Safari)
      const loginRes2 = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);
      const cookie2 = extractCookie(loginRes2, SESSION_COOKIE_NAME_DEV);
      const csrfToken2 = loginRes2.headers['x-csrf-token'];
      const csrfCookie2 = extractCookie(loginRes2, CSRF_COOKIE_NAME);

      // Also create a separate user with their own session to ensure no cross-user pollution
      const other = await createTestUser();
      const otherLoginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: other.rawEmail, password: other.password })
        .expect(200);
      const otherCookie = extractCookie(otherLoginRes, SESSION_COOKIE_NAME_DEV);

      // Call logout-all from Session 2
      const logoutAllRes = await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${cookie2}; ${CSRF_COOKIE_NAME}=${csrfCookie2}`)
        .set('X-CSRF-Token', csrfToken2)
        .expect(200);

      expect(logoutAllRes.body.success).toBe(true);

      // Session 1 is now revoked
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${cookie1}`)
        .expect(401);

      // Session 2 is now revoked
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${cookie2}`)
        .expect(401);

      // The other user's session remains perfectly active!
      const otherMeRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${otherCookie}`)
        .expect(200);
      expect(otherMeRes.body.id).toBe(other.user.id);
    });
  });

  describe('5. CSRF Defenses & Adversarial Verification (Gate A & B)', () => {
    it('issues CSRF token via GET /api/v1/auth/csrf and sets aurel_csrf cookie', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/csrf').expect(200);

      expect(res.body).toHaveProperty('csrfToken');
      expect(typeof res.body.csrfToken).toBe('string');
      const csrfCookie = extractCookie(res, CSRF_COOKIE_NAME);
      expect(csrfCookie).toBe(res.body.csrfToken);
    });

    it('adversarial scenario 1: rejects request with missing CSRF header', async () => {
      const { password, rawEmail } = await createTestUser();
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const csrfCookie = extractCookie(loginRes, CSRF_COOKIE_NAME);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=${csrfCookie}`,
        )
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('adversarial scenario 2: rejects request with missing CSRF cookie', async () => {
      const { password, rawEmail } = await createTestUser();
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const csrfToken = loginRes.headers['x-csrf-token'];

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}`)
        .set('X-CSRF-Token', csrfToken)
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('adversarial scenario 3: rejects valid header with invalid/mismatched cookie', async () => {
      const { password, rawEmail } = await createTestUser();
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const csrfToken = loginRes.headers['x-csrf-token'];

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=corrupt_cookie_token`,
        )
        .set('X-CSRF-Token', csrfToken)
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('adversarial scenario 4: rejects valid cookie with invalid header', async () => {
      const { password, rawEmail } = await createTestUser();
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const csrfCookie = extractCookie(loginRes, CSRF_COOKIE_NAME);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=${csrfCookie}`,
        )
        .set('X-CSRF-Token', 'different_header_token')
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('adversarial scenario 5: rejects malformed token encoding (non dot-separated)', async () => {
      const { password, rawEmail } = await createTestUser();
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const malformed = 'not-a-valid-token-format';

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=${malformed}`,
        )
        .set('X-CSRF-Token', malformed)
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('adversarial scenario 6: rejects truncated token', async () => {
      const { password, rawEmail } = await createTestUser();
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const truncated = loginRes.headers['x-csrf-token'].substring(0, 40);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=${truncated}`,
        )
        .set('X-CSRF-Token', truncated)
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('adversarial scenario 7: rejects modified HMAC signature', async () => {
      const { password, rawEmail } = await createTestUser();
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const parts = loginRes.headers['x-csrf-token'].split('.');
      const modifiedSignature = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'a' ? 'b' : 'a');
      const tamperedToken = `${parts[0]}.${parts[1]}.${modifiedSignature}`;

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=${tamperedToken}`,
        )
        .set('X-CSRF-Token', tamperedToken)
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('adversarial scenario 8: rejects replayed CSRF token from another session', async () => {
      const user1 = await createTestUser();
      const loginRes1 = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user1.rawEmail, password: user1.password })
        .expect(200);
      const csrfToken1 = loginRes1.headers['x-csrf-token'];

      const user2 = await createTestUser();
      const loginRes2 = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user2.rawEmail, password: user2.password })
        .expect(200);
      const sessionCookie2 = extractCookie(loginRes2, SESSION_COOKIE_NAME_DEV);

      // Submit session 1's token against session 2's session cookie
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie2}; ${CSRF_COOKIE_NAME}=${csrfToken1}`,
        )
        .set('X-CSRF-Token', csrfToken1)
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('adversarial scenario 9: rejects anonymous CSRF token used after login on authenticated endpoint', async () => {
      const anonCsrfRes = await request(app.getHttpServer()).get('/api/v1/auth/csrf').expect(200);
      const anonToken = anonCsrfRes.body.csrfToken;

      const { password, rawEmail } = await createTestUser();
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);
      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);

      // Attempt authenticated logout with anonymous token
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=${anonToken}`,
        )
        .set('X-CSRF-Token', anonToken)
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('adversarial scenario 10: rejects session-bound token used after logout', async () => {
      const { password, rawEmail } = await createTestUser();
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const csrfToken = loginRes.headers['x-csrf-token'];
      const csrfCookie = extractCookie(loginRes, CSRF_COOKIE_NAME);

      // Perform logout
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=${csrfCookie}`,
        )
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      // Attempt authenticated endpoint with revoked session token -> 401 Unauthorized
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}`)
        .expect(401);
    });

    it('adversarial scenario 11: rejects CSRF token from user A submitted with user B session', async () => {
      const userA = await createTestUser();
      const loginResA = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: userA.rawEmail, password: userA.password })
        .expect(200);
      const csrfTokenA = loginResA.headers['x-csrf-token'];

      const userB = await createTestUser();
      const loginResB = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: userB.rawEmail, password: userB.password })
        .expect(200);
      const cookieB = extractCookie(loginResB, SESSION_COOKIE_NAME_DEV);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${cookieB}; ${CSRF_COOKIE_NAME}=${csrfTokenA}`)
        .set('X-CSRF-Token', csrfTokenA)
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('adversarial scenario 12: accepts correct session-bound token and trusted Origin', async () => {
      const { password, rawEmail } = await createTestUser();
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const csrfToken = loginRes.headers['x-csrf-token'];
      const csrfCookie = extractCookie(loginRes, CSRF_COOKIE_NAME);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:5173')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=${csrfCookie}`,
        )
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('adversarial scenario 13: rejects anonymous browser registration without CSRF bootstrap, accepts with bootstrap', async () => {
      const newEmail = `browser_reg_${Date.now()}@example.com`;

      // Browser client (sends Origin) attempting registration without CSRF bootstrap -> 403 CSRF_ERROR
      const failRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:5173')
        .send({
          email: newEmail,
          password: 'ValidSecurePassphrase#2026',
          fullName: 'Browser Customer',
        })
        .expect(403);

      expect(failRes.body.code).toBe('CSRF_ERROR');

      // Bootstrap CSRF token via GET /api/v1/auth/csrf
      const csrfRes = await request(app.getHttpServer())
        .get('/api/v1/auth/csrf')
        .set('Origin', 'http://localhost:5173')
        .expect(200);

      const anonToken = csrfRes.body.csrfToken;
      const anonCookie = extractCookie(csrfRes, CSRF_COOKIE_NAME);

      // With bootstrapped CSRF token and cookie -> 201 Created
      const successRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `${CSRF_COOKIE_NAME}=${anonCookie}`)
        .set('X-CSRF-Token', anonToken)
        .send({
          email: newEmail,
          password: 'ValidSecurePassphrase#2026',
          fullName: 'Browser Customer',
        })
        .expect(201);

      expect(successRes.body.email).toBe(newEmail.toLowerCase());
      createdUserIds.push(successRes.body.id);
    });

    it('adversarial scenario 14: rejects browser login attempt without CSRF bootstrap, accepts with bootstrap', async () => {
      const { password, rawEmail } = await createTestUser();

      // Browser client attempting login without CSRF bootstrap -> 403 CSRF_ERROR
      const failRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:5173')
        .send({ email: rawEmail, password })
        .expect(403);

      expect(failRes.body.code).toBe('CSRF_ERROR');

      // Bootstrap CSRF
      const csrfRes = await request(app.getHttpServer())
        .get('/api/v1/auth/csrf')
        .set('Origin', 'http://localhost:5173')
        .expect(200);

      const anonToken = csrfRes.body.csrfToken;
      const anonCookie = extractCookie(csrfRes, CSRF_COOKIE_NAME);

      // Login with bootstrapped CSRF token -> 200 OK
      const successRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', `${CSRF_COOKIE_NAME}=${anonCookie}`)
        .set('X-CSRF-Token', anonToken)
        .send({ email: rawEmail, password })
        .expect(200);

      expect(successRes.body.email).toBe(rawEmail.toLowerCase());
    });

    it('rejects cross-origin mutations when Origin header does not match CORS whitelist', async () => {
      const { password, rawEmail } = await createTestUser();

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);
      const csrfToken = loginRes.headers['x-csrf-token'];
      const csrfCookie = extractCookie(loginRes, CSRF_COOKIE_NAME);

      // Attempt logout with malicious cross-origin Origin
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', 'https://attacker-phishing-domain.com')
        .set(
          'Cookie',
          `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}; ${CSRF_COOKIE_NAME}=${csrfCookie}`,
        )
        .set('X-CSRF-Token', csrfToken)
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('adversarial scenario 15: rejects mutation carrying ambient cookie when CSRF token is omitted', async () => {
      const { password, rawEmail } = await createTestUser();

      // Request carries an ambient cookie but no CSRF header or token -> must reject with 403 CSRF_ERROR
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Cookie', 'random_ambient_cookie=some_value')
        .send({ email: rawEmail, password })
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('adversarial scenario 16: rejects request with duplicate or comma-separated Origin header with 403 Forbidden', async () => {
      const { password, rawEmail } = await createTestUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:5173, http://localhost:5173')
        .send({ email: rawEmail, password })
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('adversarial scenario 17: permits pure non-browser API mutation with no cookies, no Origin, and no Referer', async () => {
      const newEmail = `pure_api_${Date.now()}@example.com`;

      // Pure curl/API request without any browser ambient context
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: newEmail,
          password: 'ValidSecurePassphrase#2026',
          fullName: 'API Customer',
        })
        .expect(201);

      expect(res.body.email).toBe(newEmail.toLowerCase());
      createdUserIds.push(res.body.id);
    });
  });

  describe('6. Abuse Protection & Rate Limiting Enforcement', () => {
    it('enforces IP rate limiting on login, returning HTTP 429 and Retry-After', async () => {
      rateLimiter.setCustomLimit('LOGIN_IP', 3);

      const { rawEmail } = await createTestUser();

      // 3 attempts succeed (or fail auth, but within rate limit)
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password: 'wrong' })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password: 'wrong' })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password: 'wrong' })
        .expect(401);

      // 4th attempt trips IP rate limit -> 429 Too Many Requests
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password: 'wrong' })
        .expect(429);

      expect(res.body.status).toBe(429);
      expect(res.body.code).toBe('TOO_MANY_REQUESTS');
      expect(res.headers['retry-after']).toBeDefined();
    });

    it('enforces account rate limiting on repeated failed logins for the same email', async () => {
      rateLimiter.setCustomLimit('LOGIN_ACCOUNT', 3);

      const { password, rawEmail } = await createTestUser();

      // 3 failed logins against this email
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: rawEmail, password: 'bad_password' })
          .expect(401);
      }

      // 4th attempt trips account rate limit
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(429);

      expect(res.body.status).toBe(429);
      expect(res.body.code).toBe('TOO_MANY_REQUESTS');
    });

    it('resets account rate limit counter upon successful authentication', async () => {
      rateLimiter.setCustomLimit('LOGIN_ACCOUNT', 3);

      const { password, rawEmail } = await createTestUser();

      // 2 failed attempts
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password: 'bad' })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password: 'bad' })
        .expect(401);

      // 3rd attempt is successful
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      // Counter was reset, so next failed attempt is permitted (not 429)
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password: 'bad' })
        .expect(401);
    });
  });

  describe('7. Concurrency & Relational PostgreSQL Invariants', () => {
    it('verifies cascade delete: deleting user removes all associated auth_sessions', async () => {
      const { user, password, rawEmail } = await createTestUser();

      // Create 2 sessions
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionsBefore = await prisma.authSession.findMany({
        where: { userId: user.id },
      });
      expect(sessionsBefore).toHaveLength(2);

      // Delete the user record
      await prisma.user.delete({ where: { id: user.id } });

      // Invariant: auth_sessions are cascade deleted, no orphaned sessions remain
      const sessionsAfter = await prisma.authSession.findMany({
        where: { userId: user.id },
      });
      expect(sessionsAfter).toHaveLength(0);
    });

    it('enforces token_digest unique constraint at PostgreSQL engine level', async () => {
      const { user } = await createTestUser();
      const duplicateDigest = 'c'.repeat(64);

      // First insert succeeds
      await prisma.authSession.create({
        data: {
          userId: user.id,
          tokenDigest: duplicateDigest,
          expiresAt: new Date(Date.now() + 100000),
        },
      });

      // Second insert with identical token_digest must throw 23505 (unique constraint violation)
      await expect(
        prisma.authSession.create({
          data: {
            userId: user.id,
            tokenDigest: duplicateDigest,
            expiresAt: new Date(Date.now() + 100000),
          },
        }),
      ).rejects.toThrow();
    });

    it('safely handles concurrent logins from multiple clients simultaneously', async () => {
      const { password, rawEmail } = await createTestUser();

      // Launch 5 parallel logins for the same account
      const loginPromises = Array.from({ length: 5 }).map(() =>
        request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: rawEmail, password }),
      );

      const results = await Promise.all(loginPromises);

      // All 5 logins should succeed with distinct sessions
      const sessionCookies = results.map((r) => extractCookie(r, SESSION_COOKIE_NAME_DEV));
      expect(new Set(sessionCookies).size).toBe(5);
    });

    it('rejects session creation atomically if user is deactivated concurrent with login', async () => {
      const { user, password, rawEmail } = await createTestUser();

      // Deactivate user in PostgreSQL right before authentication completes
      await prisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(401);

      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('Gate B: serializes concurrent session creation against in-flight account deactivation transaction via row lock', async () => {
      const { user, password, rawEmail } = await createTestUser();

      // Launch an explicit interactive transaction holding an exclusive row lock on the user
      let releaseTransaction: () => void = () => {};
      const txPromise = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`
            UPDATE users SET is_active = false WHERE id = ${user.id}::uuid
          `;
          await new Promise<void>((resolve) => {
            releaseTransaction = resolve;
          });
        },
        { timeout: 10000 },
      );

      // Brief delay to allow tx to acquire the row lock
      await new Promise((resolve) => setTimeout(resolve, 50));

      // In-flight login request must block on PostgreSQL row lock FOR UPDATE
      const loginPromise = request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password });

      // Ensure login has not resolved yet because it is blocked on the row lock
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Release and commit the deactivation transaction
      releaseTransaction();
      await txPromise;

      // The login request unblocks, observes is_active = false under FOR UPDATE, and rejects with 401
      const res = await loginPromise;
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');

      // Invariant: no active session was created in PostgreSQL
      const sessions = await prisma.authSession.findMany({ where: { userId: user.id } });
      expect(sessions).toHaveLength(0);
    });
  });

  describe('8. Gate G — API Contract Consistency & Sanitization Invariants', () => {
    it('verifies register, login, and me endpoints return identical public user contract schemas', async () => {
      const { user, password, rawEmail } = await createTestUser();

      // 1. Login response contract
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: rawEmail, password })
        .expect(200);

      const sessionCookie = extractCookie(loginRes, SESSION_COOKIE_NAME_DEV);

      // 2. /auth/me response contract
      const meRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `${SESSION_COOKIE_NAME_DEV}=${sessionCookie}`)
        .expect(200);

      const expectedKeys = ['id', 'email', 'fullName', 'isActive', 'createdAt'];

      for (const key of expectedKeys) {
        expect(loginRes.body).toHaveProperty(key);
        expect(meRes.body).toHaveProperty(key);
      }

      // INVARIANT: Both must use 'fullName', not 'displayName'
      expect(loginRes.body.fullName).toBe(user.fullName);
      expect(meRes.body.fullName).toBe(user.fullName);
      expect(loginRes.body.displayName).toBeUndefined();
      expect(meRes.body.displayName).toBeUndefined();

      // INVARIANT: Neither must leak 'role', 'passwordHash', or 'token'
      expect(loginRes.body.role).toBeUndefined();
      expect(meRes.body.role).toBeUndefined();
      expect(loginRes.body.passwordHash).toBeUndefined();
      expect(meRes.body.passwordHash).toBeUndefined();
      expect(loginRes.body.token).toBeUndefined();
      expect(meRes.body.token).toBeUndefined();
      expect(loginRes.body.sessionToken).toBeUndefined();
      expect(meRes.body.sessionToken).toBeUndefined();
    });
  });

  describe('9. Gate P2.2.3 — Trusted Proxy Hardening & Client-IP Security Invariants', () => {
    let proxyApp: INestApplication;
    let proxyRateLimiter: RateLimiterService;

    beforeAll(async () => {
      const proxyFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      proxyApp = proxyFixture.createNestApplication();
      proxyApp.setGlobalPrefix('api/v1');
      proxyApp.use(cookieParser());
      proxyApp.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          transform: true,
          forbidNonWhitelisted: true,
        }),
      );
      proxyApp.useGlobalFilters(new GlobalExceptionFilter());

      // Explicitly configure 1-hop reverse proxy trust
      configureTrustProxy(proxyApp, true);
      await proxyApp.init();

      proxyRateLimiter = proxyApp.get(RateLimiterService);
    });

    afterAll(async () => {
      if (proxyApp) {
        await proxyApp.close();
      }
    });

    beforeEach(() => {
      rateLimiter.clearAll();
      rateLimiter.resetCustomLimits();
      if (proxyRateLimiter) {
        proxyRateLimiter.clearAll();
        proxyRateLimiter.resetCustomLimits();
      }
    });

    it('Scenario 1: Default app (TRUST_PROXY=false) ignores spoofed X-Forwarded-For and derives client IP from socket', async () => {
      const { password, rawEmail } = await createTestUser();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '203.0.113.195')
        .send({ email: rawEmail, password })
        .expect(200);

      expect(res.body.email).toBe(rawEmail.toLowerCase());
    });

    it('Scenario 2: Prevents rate-limit evasion via rotating X-Forwarded-For headers when TRUST_PROXY=false', async () => {
      rateLimiter.setCustomLimit('LOGIN_IP', 3);
      const { rawEmail } = await createTestUser();

      // Attacker attempts 3 failed logins, sending different spoofed X-Forwarded-For on each attempt
      for (let i = 1; i <= 3; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', `198.51.100.${i}`)
          .send({ email: rawEmail, password: 'wrong_password' })
          .expect(401);
      }

      // 4th attempt with yet another spoofed IP must STILL be rate-limited with HTTP 429
      // because Express maps all requests to the true socket connection IP (127.0.0.1)
      const blockedRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '198.51.100.99')
        .send({ email: rawEmail, password: 'wrong_password' })
        .expect(429);

      expect(blockedRes.body.code).toBe('TOO_MANY_REQUESTS');
      expect(blockedRes.headers['retry-after']).toBeDefined();
    });

    it('Scenario 3: Trusted proxy app (trust proxy = 1) extracts client IP from 1-hop reverse proxy', async () => {
      proxyRateLimiter.setCustomLimit('LOGIN_IP', 2);
      const { rawEmail } = await createTestUser();

      // Reverse proxy forwards real client IP 198.51.100.25
      await request(proxyApp.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '198.51.100.25')
        .send({ email: rawEmail, password: 'wrong_password' })
        .expect(401);

      await request(proxyApp.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '198.51.100.25')
        .send({ email: rawEmail, password: 'wrong_password' })
        .expect(401);

      // 3rd attempt from same forwarded client IP is rate limited
      const res = await request(proxyApp.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '198.51.100.25')
        .send({ email: rawEmail, password: 'wrong_password' })
        .expect(429);

      expect(res.body.code).toBe('TOO_MANY_REQUESTS');

      // But a request from a different client IP through the proxy is permitted
      await request(proxyApp.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '198.51.100.77')
        .send({ email: rawEmail, password: 'wrong_password' })
        .expect(401);
    });

    it('Scenario 4: Trusted proxy app ignores spoofed leftmost IP in chained X-Forwarded-For (takes 1st trusted hop from right)', async () => {
      proxyRateLimiter.setCustomLimit('LOGIN_IP', 2);
      const { rawEmail } = await createTestUser();

      // Attacker injected 1.1.1.1, reverse proxy appended 203.0.113.195
      // Express with trust proxy = 1 evaluates the client IP as 203.0.113.195 (not 1.1.1.1)
      await request(proxyApp.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '1.1.1.1, 203.0.113.195')
        .send({ email: rawEmail, password: 'wrong_password' })
        .expect(401);

      await request(proxyApp.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '2.2.2.2, 203.0.113.195')
        .send({ email: rawEmail, password: 'wrong_password' })
        .expect(401);

      // Changing the spoofed prefix (3.3.3.3) does NOT bypass throttling because client IP is 203.0.113.195
      const res = await request(proxyApp.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '3.3.3.3, 203.0.113.195')
        .send({ email: rawEmail, password: 'wrong_password' })
        .expect(429);

      expect(res.body.code).toBe('TOO_MANY_REQUESTS');
    });

    it('Scenario 5: Handles malformed and special X-Forwarded-For values gracefully without crashing', async () => {
      const { password, rawEmail } = await createTestUser();

      const malformedHeaders = [
        'not_an_ip_address',
        '999.999.999.999',
        '<script>alert(1)</script>',
        '   ',
        '127.0.0.1, , 10.0.0.1',
      ];

      for (const header of malformedHeaders) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', header)
          .send({ email: rawEmail, password })
          .expect(200);

        expect(res.body.email).toBe(rawEmail.toLowerCase());
      }
    });

    it('Scenario 6: Verifies literal TRUST_PROXY=false string parses to boolean false in environment validation', () => {
      const config = {
        DATABASE_URL: 'postgresql://postgres:password@localhost:5432/aurel_test',
        TRUST_PROXY: 'false',
      };
      const parsed = validateEnvironment(config);
      expect(parsed.TRUST_PROXY).toBe(false);
      expect(typeof parsed.TRUST_PROXY).toBe('boolean');
    });

    it('Scenario 7: Rejects malformed TRUST_PROXY values, preventing silent proxy trust activation', () => {
      const malformedValues = ['0', '1', 'yes', 'no', 'enabled', 'invalid'];
      for (const val of malformedValues) {
        expect(() =>
          validateEnvironment({
            DATABASE_URL: 'postgresql://postgres:password@localhost:5432/aurel_test',
            TRUST_PROXY: val,
          }),
        ).toThrow(/TRUST_PROXY must be an explicit boolean/);
      }
    });
  });
});
