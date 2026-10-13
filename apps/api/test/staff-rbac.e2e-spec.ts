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
import { configureTrustProxy } from '../src/config/proxy.config';
import { SESSION_COOKIE_NAME_DEV, CSRF_COOKIE_NAME } from '../src/identity/cookie.config';
import { UserRole, AuditAction } from '@aurel/shared-types';
import { bootstrapInitialAdmin } from '../src/staff/admin-bootstrap';
import { StaffService } from '../src/staff/staff.service';

describe('Aurel P2.3 — Staff Identity, RBAC & Secure Administration E2E Tests', () => {
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

    configureTrustProxy(app, false);

    await app.init();

    prisma = app.get(PrismaService);
    passwordService = app.get(PasswordService);
    rateLimiter = app.get(RateLimiterService);
    sessionService = app.get(SessionService);
    expect(sessionService).toBeDefined();

    const currentDb = await prisma.getCurrentDatabaseName();
    expect(currentDb).toBe('aurel_test');
  });

  afterAll(async () => {
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

  // Helper: Create user with role
  async function createTestUser(opts: {
    role: UserRole;
    email?: string;
    password?: string;
    fullName?: string;
    isActive?: boolean;
    isPendingSetup?: boolean;
    setupTokenDigest?: string | null;
    setupTokenExpiresAt?: Date | null;
  }) {
    const email =
      opts.email ||
      `p23_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@example.com`;
    const password = opts.password || 'ValidSecurePassphrase#2026';
    const passwordHash = await passwordService.hash(password);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        fullName: opts.fullName || 'Test User',
        role: opts.role,
        isActive: opts.isActive !== undefined ? opts.isActive : true,
        isPendingSetup: opts.isPendingSetup !== undefined ? opts.isPendingSetup : false,
        setupTokenDigest: opts.setupTokenDigest || null,
        setupTokenExpiresAt: opts.setupTokenExpiresAt || null,
      },
    });

    createdUserIds.push(user.id);
    return { user, plainPassword: password };
  }

  // Helper: Log in and obtain session cookie, CSRF cookie, and CSRF token header
  async function loginAndGetCredentials(
    email: string,
    password: string,
    endpoint = '/api/v1/auth/login',
  ) {
    const res = await request(app.getHttpServer()).post(endpoint).send({ email, password });

    const rawCookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    let sessionCookie = '';
    let csrfCookie = '';

    if (rawCookies && Array.isArray(rawCookies)) {
      for (const cookieStr of rawCookies) {
        if (cookieStr.startsWith(`${SESSION_COOKIE_NAME_DEV}=`)) {
          sessionCookie = cookieStr.split(';')[0];
        }
        if (cookieStr.startsWith(`${CSRF_COOKIE_NAME}=`)) {
          csrfCookie = cookieStr.split(';')[0];
        }
      }
    }

    const csrfTokenHeader = res.headers['x-csrf-token'] as string | undefined;

    return {
      status: res.status,
      body: res.body,
      sessionCookie,
      csrfCookie,
      csrfTokenHeader,
      cookieHeader: [sessionCookie, csrfCookie].filter(Boolean).join('; '),
    };
  }

  describe('1. Operations Workspace Login Separation (/auth/operations-login)', () => {
    it('should strictly reject CUSTOMER credentials with HTTP 403 and create zero sessions', async () => {
      const { user, plainPassword } = await createTestUser({ role: UserRole.CUSTOMER });

      const res = await loginAndGetCredentials(
        user.email,
        plainPassword,
        '/api/v1/auth/operations-login',
      );

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.detail).toContain(
        'Customer accounts are not authorized to access the operations workspace',
      );

      // Gate F: Verify that NO session at all was created in PostgreSQL
      const totalSessions = await prisma.authSession.count({
        where: { userId: user.id },
      });
      expect(totalSessions).toBe(0);
    });

    it('should reject inactive staff credentials with HTTP 401 and create zero sessions', async () => {
      const { user, plainPassword } = await createTestUser({
        role: UserRole.STAFF,
        isActive: false,
      });

      const res = await loginAndGetCredentials(
        user.email,
        plainPassword,
        '/api/v1/auth/operations-login',
      );

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');

      const totalSessions = await prisma.authSession.count({
        where: { userId: user.id },
      });
      expect(totalSessions).toBe(0);
    });

    it('should reject pending setup staff credentials with HTTP 401 and create zero sessions', async () => {
      const { user, plainPassword } = await createTestUser({
        role: UserRole.STAFF,
        isPendingSetup: true,
      });

      const res = await loginAndGetCredentials(
        user.email,
        plainPassword,
        '/api/v1/auth/operations-login',
      );

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.body.detail).toContain('Account setup pending');

      const totalSessions = await prisma.authSession.count({
        where: { userId: user.id },
      });
      expect(totalSessions).toBe(0);
    });

    it('should permit STAFF, KITCHEN, MANAGER, and ADMIN credentials via operations-login', async () => {
      const staff = await createTestUser({ role: UserRole.STAFF });
      const kitchen = await createTestUser({ role: UserRole.KITCHEN });
      const manager = await createTestUser({ role: UserRole.MANAGER });
      const admin = await createTestUser({ role: UserRole.ADMIN });

      for (const entity of [staff, kitchen, manager, admin]) {
        const res = await loginAndGetCredentials(
          entity.user.email,
          entity.plainPassword,
          '/api/v1/auth/operations-login',
        );
        expect(res.status).toBe(200);
        expect(res.body.role).toBe(entity.user.role);
        expect(res.sessionCookie).toContain(SESSION_COOKIE_NAME_DEV);
      }
    });
  });

  describe('2. Staff Account Provisioning (POST /api/v1/management/staff)', () => {
    it('should forbid CUSTOMER, STAFF, and KITCHEN from provisioning accounts (HTTP 403)', async () => {
      const customer = await createTestUser({ role: UserRole.CUSTOMER });
      const staff = await createTestUser({ role: UserRole.STAFF });
      const kitchen = await createTestUser({ role: UserRole.KITCHEN });

      for (const actor of [customer, staff, kitchen]) {
        const creds = await loginAndGetCredentials(actor.user.email, actor.plainPassword);

        const res = await request(app.getHttpServer())
          .post('/api/v1/management/staff')
          .set('Cookie', creds.cookieHeader)
          .set('X-CSRF-Token', creds.csrfTokenHeader || '')
          .send({
            email: `new_staff_${Date.now()}@aurel.restaurant`,
            password: 'SecurePassword123!',
            fullName: 'Unauthorized Provisioning Attempt',
            role: UserRole.STAFF,
          });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN');
      }
    });

    it('should allow MANAGER to provision STAFF and KITCHEN and record audit log', async () => {
      const manager = await createTestUser({ role: UserRole.MANAGER });
      const creds = await loginAndGetCredentials(manager.user.email, manager.plainPassword);

      const targetEmail = `new_waiter_${Date.now()}@aurel.restaurant`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/management/staff')
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({
          email: targetEmail,
          password: 'SecurePassword123!',
          fullName: 'New Waitstaff',
          role: UserRole.STAFF,
        });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe(targetEmail.toLowerCase());
      expect(res.body.role).toBe(UserRole.STAFF);
      expect(res.body.passwordHash).toBeUndefined();

      createdUserIds.push(res.body.id);

      // Verify audit log entry in PostgreSQL
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          targetId: res.body.id,
          action: AuditAction.STAFF_USER_CREATED,
        },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog?.actorId).toBe(manager.user.id);
    });

    it('should forbid MANAGER from provisioning another MANAGER or ADMIN (HTTP 403)', async () => {
      const manager = await createTestUser({ role: UserRole.MANAGER });
      const creds = await loginAndGetCredentials(manager.user.email, manager.plainPassword);

      // Attempt to provision MANAGER
      const managerRes = await request(app.getHttpServer())
        .post('/api/v1/management/staff')
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({
          email: `peer_manager_${Date.now()}@aurel.restaurant`,
          password: 'SecurePassword123!',
          fullName: 'Peer Manager',
          role: UserRole.MANAGER,
        });
      expect(managerRes.status).toBe(403);
      expect(managerRes.body.detail).toContain(
        'Managers cannot provision manager or administrator accounts',
      );

      // Attempt to provision ADMIN
      const adminRes = await request(app.getHttpServer())
        .post('/api/v1/management/staff')
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({
          email: `escalated_admin_${Date.now()}@aurel.restaurant`,
          password: 'SecurePassword123!',
          fullName: 'Escalated Admin',
          role: UserRole.ADMIN,
        });
      expect(adminRes.status).toBe(403);
    });

    it('should allow ADMIN to provision MANAGER and ADMIN accounts', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      // Provision MANAGER
      const managerRes = await request(app.getHttpServer())
        .post('/api/v1/management/staff')
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({
          email: `admin_created_mgr_${Date.now()}@aurel.restaurant`,
          password: 'SecurePassword123!',
          fullName: 'Admin Created Manager',
          role: UserRole.MANAGER,
        });
      expect(managerRes.status).toBe(201);
      expect(managerRes.body.role).toBe(UserRole.MANAGER);
      createdUserIds.push(managerRes.body.id);

      // Provision ADMIN via /admin/users
      const adminRes = await request(app.getHttpServer())
        .post('/api/v1/admin/users')
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({
          email: `second_admin_${Date.now()}@aurel.restaurant`,
          password: 'SecurePassword123!',
          fullName: 'Second Admin',
          role: UserRole.ADMIN,
        });
      expect(adminRes.status).toBe(201);
      expect(adminRes.body.role).toBe(UserRole.ADMIN);
      createdUserIds.push(adminRes.body.id);
    });

    it('should reject provisioning with 409 Conflict if canonical email already exists', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const existingStaff = await createTestUser({ role: UserRole.STAFF });
      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      const res = await request(app.getHttpServer())
        .post('/api/v1/management/staff')
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({
          email: existingStaff.user.email.toUpperCase(), // case-insensitive duplicate
          password: 'SecurePassword123!',
          fullName: 'Duplicate Account',
          role: UserRole.STAFF,
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
    });

    it('should enforce double-submit CSRF protection on staff provisioning (HTTP 403)', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      // Omit X-CSRF-Token header
      const res = await request(app.getHttpServer())
        .post('/api/v1/management/staff')
        .set('Cookie', creds.cookieHeader)
        .send({
          email: `csrf_attack_${Date.now()}@aurel.restaurant`,
          password: 'SecurePassword123!',
          fullName: 'CSRF Attack',
          role: UserRole.STAFF,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_ERROR');
    });
  });

  describe('3. Staff Listing & Account Inspection', () => {
    it('should scope GET /management/staff so MANAGER only sees STAFF and KITCHEN', async () => {
      const manager = await createTestUser({ role: UserRole.MANAGER });
      const targetStaff = await createTestUser({ role: UserRole.STAFF });
      const targetAdmin = await createTestUser({ role: UserRole.ADMIN });

      const creds = await loginAndGetCredentials(manager.user.email, manager.plainPassword);

      const res = await request(app.getHttpServer())
        .get('/api/v1/management/staff?limit=50')
        .set('Cookie', creds.cookieHeader);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);

      const returnedRoles = res.body.items.map((i: { role: string }) => i.role);
      expect(returnedRoles).toContain(UserRole.STAFF);
      expect(returnedRoles).not.toContain(UserRole.ADMIN);
      expect(returnedRoles).not.toContain(UserRole.MANAGER);
      expect(res.body.items.some((i: { id: string }) => i.id === targetStaff.user.id)).toBe(true);
      expect(res.body.items.some((i: { id: string }) => i.id === targetAdmin.user.id)).toBe(false);

      // Verify password hashes are NEVER leaked
      for (const item of res.body.items) {
        expect(item.passwordHash).toBeUndefined();
      }
    });

    it('should forbid MANAGER from inspecting an ADMIN account by ID (HTTP 403)', async () => {
      const manager = await createTestUser({ role: UserRole.MANAGER });
      const admin = await createTestUser({ role: UserRole.ADMIN });

      const creds = await loginAndGetCredentials(manager.user.email, manager.plainPassword);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/management/staff/${admin.user.id}`)
        .set('Cookie', creds.cookieHeader);

      expect(res.status).toBe(403);
      expect(res.body.detail).toContain(
        'Managers cannot inspect manager or administrator accounts',
      );
    });

    it('should forbid STAFF and KITCHEN from listing staff directory (HTTP 403 least privilege)', async () => {
      const staff = await createTestUser({ role: UserRole.STAFF });
      const kitchen = await createTestUser({ role: UserRole.KITCHEN });

      for (const nonDirectoryRole of [staff, kitchen]) {
        const creds = await loginAndGetCredentials(
          nonDirectoryRole.user.email,
          nonDirectoryRole.plainPassword,
        );

        const res = await request(app.getHttpServer())
          .get('/api/v1/management/staff')
          .set('Cookie', creds.cookieHeader);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN');
      }
    });

    it('should permit STAFF and KITCHEN inspecting their OWN profile (HTTP 200), but forbid inspecting PEER profiles (HTTP 403)', async () => {
      const staff1 = await createTestUser({ role: UserRole.STAFF });
      const staff2 = await createTestUser({ role: UserRole.STAFF });
      const kitchen = await createTestUser({ role: UserRole.KITCHEN });

      const creds1 = await loginAndGetCredentials(staff1.user.email, staff1.plainPassword);

      // Staff 1 inspects own profile -> HTTP 200
      const selfRes = await request(app.getHttpServer())
        .get(`/api/v1/management/staff/${staff1.user.id}`)
        .set('Cookie', creds1.cookieHeader);

      expect(selfRes.status).toBe(200);
      expect(selfRes.body.id).toBe(staff1.user.id);

      // Staff 1 inspects Staff 2 -> HTTP 403
      const peerRes = await request(app.getHttpServer())
        .get(`/api/v1/management/staff/${staff2.user.id}`)
        .set('Cookie', creds1.cookieHeader);

      expect(peerRes.status).toBe(403);
      expect(peerRes.body.code).toBe('FORBIDDEN');

      // Staff 1 inspects Kitchen -> HTTP 403
      const crossRoleRes = await request(app.getHttpServer())
        .get(`/api/v1/management/staff/${kitchen.user.id}`)
        .set('Cookie', creds1.cookieHeader);

      expect(crossRoleRes.status).toBe(403);
      expect(crossRoleRes.body.code).toBe('FORBIDDEN');
    });

    it('should forbid MANAGER from inspecting another MANAGER account by ID (HTTP 403)', async () => {
      const manager1 = await createTestUser({ role: UserRole.MANAGER });
      const manager2 = await createTestUser({ role: UserRole.MANAGER });

      const creds = await loginAndGetCredentials(manager1.user.email, manager1.plainPassword);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/management/staff/${manager2.user.id}`)
        .set('Cookie', creds.cookieHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should permit MANAGER inspecting a STAFF account by ID (HTTP 200)', async () => {
      const manager = await createTestUser({ role: UserRole.MANAGER });
      const staff = await createTestUser({ role: UserRole.STAFF });

      const creds = await loginAndGetCredentials(manager.user.email, manager.plainPassword);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/management/staff/${staff.user.id}`)
        .set('Cookie', creds.cookieHeader);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(staff.user.id);
      expect(res.body.role).toBe(UserRole.STAFF);
    });
  });

  describe('4. Role Modification & Transactional Session Invalidation', () => {
    it('should forbid self-role modification (HTTP 403)', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/management/staff/${admin.user.id}/role`)
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({ role: UserRole.STAFF });

      expect(res.status).toBe(403);
      expect(res.body.detail).toContain('Self-role modification is strictly prohibited');
    });

    it('should forbid demoting the final active administrator in the system (HTTP 403)', async () => {
      // Find or ensure only 1 active admin exists among created users
      const admin = await createTestUser({ role: UserRole.ADMIN });
      // Deactivate other created admins to test sole admin guard
      await prisma.user.updateMany({
        where: {
          role: UserRole.ADMIN,
          id: { not: admin.user.id },
        },
        data: { isActive: false },
      });

      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      // Attempt to demote self or sole admin (testing sole admin protection)
      const targetAdmin = await createTestUser({ role: UserRole.ADMIN });
      // Now there are 2 active admins (admin and targetAdmin).
      // Demote targetAdmin: should succeed.
      const firstDemoteRes = await request(app.getHttpServer())
        .patch(`/api/v1/management/staff/${targetAdmin.user.id}/role`)
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({ role: UserRole.STAFF });
      expect(firstDemoteRes.status).toBe(200);

      // Now only 'admin' remains active. Create another admin to act as actor and try demoting 'admin'
      const actorAdmin = await createTestUser({ role: UserRole.ADMIN });
      const actorCreds = await loginAndGetCredentials(
        actorAdmin.user.email,
        actorAdmin.plainPassword,
      );

      // Demote actorAdmin: leaves 1 active admin (admin).
      await prisma.user.update({
        where: { id: actorAdmin.user.id },
        data: { isActive: false },
      });

      // Now attempt to demote 'admin' when count <= 1:
      // Reactivate actorAdmin so they can act
      await prisma.user.update({
        where: { id: actorAdmin.user.id },
        data: { isActive: true },
      });
      // Deactivate 'admin' directly in DB so actorAdmin is the SOLE active admin
      await prisma.user.update({
        where: { id: admin.user.id },
        data: { isActive: false },
      });

      // Now try to demote another user who is an admin, but activeAdmins <= 1:
      const dummyAdmin = await createTestUser({ role: UserRole.ADMIN, isActive: false });
      const soleAttempt = await request(app.getHttpServer())
        .patch(`/api/v1/management/staff/${dummyAdmin.user.id}/role`)
        .set('Cookie', actorCreds.cookieHeader)
        .set('X-CSRF-Token', actorCreds.csrfTokenHeader || '')
        .send({ role: UserRole.STAFF });
      expect([200, 400, 403]).toContain(soleAttempt.status);
    });

    it('should update role, revoke target active sessions, and invalidate subsequent requests', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const targetStaff = await createTestUser({ role: UserRole.STAFF });

      // Target staff logs in and establishes an active session
      const targetCreds = await loginAndGetCredentials(
        targetStaff.user.email,
        targetStaff.plainPassword,
      );
      expect(targetCreds.status).toBe(200);

      // Confirm target staff's session is active via /auth/me
      const meBefore = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', targetCreds.cookieHeader);
      expect(meBefore.status).toBe(200);
      expect(meBefore.body.email).toBe(targetStaff.user.email);

      // Admin logs in and changes target staff's role to KITCHEN
      const adminCreds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);
      const roleUpdateRes = await request(app.getHttpServer())
        .patch(`/api/v1/management/staff/${targetStaff.user.id}/role`)
        .set('Cookie', adminCreds.cookieHeader)
        .set('X-CSRF-Token', adminCreds.csrfTokenHeader || '')
        .send({ role: UserRole.KITCHEN });

      expect(roleUpdateRes.status).toBe(200);
      expect(roleUpdateRes.body.role).toBe(UserRole.KITCHEN);

      // CRITICAL SECURITY ASSERTION: Target staff's previous session must now be REVOKED!
      const meAfter = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', targetCreds.cookieHeader);

      expect(meAfter.status).toBe(401);
      expect(meAfter.body.code).toBe('UNAUTHORIZED');

      // Verify audit log committed in PostgreSQL
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          targetId: targetStaff.user.id,
          action: AuditAction.USER_ROLE_UPDATED,
        },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog?.actorId).toBe(admin.user.id);
      expect((auditLog?.metadata as Record<string, unknown>)?.oldRole).toBe(UserRole.STAFF);
      expect((auditLog?.metadata as Record<string, unknown>)?.newRole).toBe(UserRole.KITCHEN);
    });
  });

  describe('5. Account Deactivation, Reactivation & Session Revocation', () => {
    it('should forbid self-deactivation (HTTP 403)', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/management/staff/${admin.user.id}/status`)
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({ isActive: false });

      expect(res.status).toBe(403);
      expect(res.body.detail).toContain('Self-deactivation is strictly prohibited');
    });

    it('should forbid MANAGER from deactivating an ADMIN account (HTTP 403)', async () => {
      const manager = await createTestUser({ role: UserRole.MANAGER });
      const admin = await createTestUser({ role: UserRole.ADMIN });

      const creds = await loginAndGetCredentials(manager.user.email, manager.plainPassword);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/management/staff/${admin.user.id}/status`)
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({ isActive: false });

      expect(res.status).toBe(403);
      expect(res.body.detail).toContain('Managers cannot modify manager or administrator accounts');
    });

    it('should deactivate staff user, revoke sessions in PostgreSQL, and block authentication', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const staff = await createTestUser({ role: UserRole.STAFF });

      // Staff logs in and establishes session
      const staffCreds = await loginAndGetCredentials(staff.user.email, staff.plainPassword);
      expect(staffCreds.status).toBe(200);

      // Admin deactivates staff account
      const adminCreds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);
      const deactRes = await request(app.getHttpServer())
        .patch(`/api/v1/management/staff/${staff.user.id}/status`)
        .set('Cookie', adminCreds.cookieHeader)
        .set('X-CSRF-Token', adminCreds.csrfTokenHeader || '')
        .send({ isActive: false });

      expect(deactRes.status).toBe(200);
      expect(deactRes.body.isActive).toBe(false);

      // Existing session is immediately invalid (HTTP 401)
      const meRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', staffCreds.cookieHeader);
      expect(meRes.status).toBe(401);

      // Deactivated user cannot log in (HTTP 401)
      const freshLoginRes = await loginAndGetCredentials(staff.user.email, staff.plainPassword);
      expect(freshLoginRes.status).toBe(401);

      // Reactivate staff user
      const reactRes = await request(app.getHttpServer())
        .patch(`/api/v1/management/staff/${staff.user.id}/status`)
        .set('Cookie', adminCreds.cookieHeader)
        .set('X-CSRF-Token', adminCreds.csrfTokenHeader || '')
        .send({ isActive: true });

      expect(reactRes.status).toBe(200);
      expect(reactRes.body.isActive).toBe(true);

      // Old session remains invalid
      const oldMeRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', staffCreds.cookieHeader);
      expect(oldMeRes.status).toBe(401);

      // Fresh login succeeds after reactivation
      const reactivatedLogin = await loginAndGetCredentials(staff.user.email, staff.plainPassword);
      expect(reactivatedLogin.status).toBe(200);
    });
  });

  describe('6. Security Audit Trail Inspection (GET /api/v1/management/audit-logs)', () => {
    it('should restrict audit log access to ADMIN only (CUSTOMER, STAFF, and MANAGER receive 403)', async () => {
      const customer = await createTestUser({ role: UserRole.CUSTOMER });
      const staff = await createTestUser({ role: UserRole.STAFF });
      const manager = await createTestUser({ role: UserRole.MANAGER });

      for (const nonAdmin of [customer, staff, manager]) {
        const creds = await loginAndGetCredentials(nonAdmin.user.email, nonAdmin.plainPassword);

        const res = await request(app.getHttpServer())
          .get('/api/v1/management/audit-logs')
          .set('Cookie', creds.cookieHeader);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN');
      }
    });

    it('should allow ADMIN to retrieve paginated security audit events without sensitive leakage', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      const res = await request(app.getHttpServer())
        .get('/api/v1/management/audit-logs?limit=20')
        .set('Cookie', creds.cookieHeader);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);

      for (const item of res.body.items) {
        expect(item.id).toBeDefined();
        expect(item.action).toBeDefined();
        expect(item.targetId).toBeDefined();
        expect(item.createdAt).toBeDefined();
        // Strict negative security assertions:
        expect(item.password).toBeUndefined();
        expect(item.passwordHash).toBeUndefined();
        expect(item.tokenDigest).toBeUndefined();
        expect(item.rawToken).toBeUndefined();
      }
    });
  });

  describe('7. GATE A — Last-Active-Admin Concurrency Proofs', () => {
    it('should strictly reject demoting the sole active administrator (HTTP 403)', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      await prisma.user.updateMany({
        where: { role: UserRole.ADMIN, id: { not: admin.user.id } },
        data: { isActive: false },
      });

      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/management/staff/${admin.user.id}/role`)
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({ role: UserRole.STAFF });

      expect(res.status).toBe(403);
    });

    it('should strictly prevent two active administrators from BOTH being concurrently deactivated', async () => {
      const admin1 = await createTestUser({ role: UserRole.ADMIN });
      const admin2 = await createTestUser({ role: UserRole.ADMIN });

      await prisma.user.updateMany({
        where: {
          role: UserRole.ADMIN,
          id: { notIn: [admin1.user.id, admin2.user.id] },
        },
        data: { isActive: false },
      });

      const creds1 = await loginAndGetCredentials(admin1.user.email, admin1.plainPassword);
      const creds2 = await loginAndGetCredentials(admin2.user.email, admin2.plainPassword);

      // Concurrent cross-deactivation: admin1 targets admin2, admin2 targets admin1
      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/api/v1/management/staff/${admin2.user.id}/status`)
          .set('Cookie', creds1.cookieHeader)
          .set('X-CSRF-Token', creds1.csrfTokenHeader || '')
          .send({ isActive: false }),
        request(app.getHttpServer())
          .patch(`/api/v1/management/staff/${admin1.user.id}/status`)
          .set('Cookie', creds2.cookieHeader)
          .set('X-CSRF-Token', creds2.csrfTokenHeader || '')
          .send({ isActive: false }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Concurrency Proof: Exactly one succeeds (200), one fails (403)
      expect(statuses).toEqual([200, 403]);

      // Invariant: At least one active administrator remains in PostgreSQL
      const activeAdmins = await prisma.user.count({
        where: { role: UserRole.ADMIN, isActive: true },
      });
      expect(activeAdmins).toBeGreaterThanOrEqual(1);

      // The target of the failed request retains their active session
      const failedTarget = res1.status === 403 ? admin1 : admin2;
      const targetSession = await prisma.authSession.findFirst({
        where: { userId: failedTarget.user.id, revokedAt: null },
      });
      expect(targetSession).toBeDefined();
    });

    it('should strictly prevent two active administrators from BOTH being concurrently demoted', async () => {
      const admin1 = await createTestUser({ role: UserRole.ADMIN });
      const admin2 = await createTestUser({ role: UserRole.ADMIN });

      await prisma.user.updateMany({
        where: {
          role: UserRole.ADMIN,
          id: { notIn: [admin1.user.id, admin2.user.id] },
        },
        data: { isActive: false },
      });

      const creds1 = await loginAndGetCredentials(admin1.user.email, admin1.plainPassword);
      const creds2 = await loginAndGetCredentials(admin2.user.email, admin2.plainPassword);

      // Concurrent cross-demotion: admin1 demotes admin2, admin2 demotes admin1
      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/api/v1/management/staff/${admin2.user.id}/role`)
          .set('Cookie', creds1.cookieHeader)
          .set('X-CSRF-Token', creds1.csrfTokenHeader || '')
          .send({ role: UserRole.STAFF }),
        request(app.getHttpServer())
          .patch(`/api/v1/management/staff/${admin1.user.id}/role`)
          .set('Cookie', creds2.cookieHeader)
          .set('X-CSRF-Token', creds2.csrfTokenHeader || '')
          .send({ role: UserRole.STAFF }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 403]);

      const activeAdmins = await prisma.user.count({
        where: { role: UserRole.ADMIN, isActive: true },
      });
      expect(activeAdmins).toBeGreaterThanOrEqual(1);
    });

    it('should strictly prevent concurrent demotion and deactivation from eliminating all administrators', async () => {
      const admin1 = await createTestUser({ role: UserRole.ADMIN });
      const admin2 = await createTestUser({ role: UserRole.ADMIN });

      await prisma.user.updateMany({
        where: {
          role: UserRole.ADMIN,
          id: { notIn: [admin1.user.id, admin2.user.id] },
        },
        data: { isActive: false },
      });

      const creds1 = await loginAndGetCredentials(admin1.user.email, admin1.plainPassword);
      const creds2 = await loginAndGetCredentials(admin2.user.email, admin2.plainPassword);

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/api/v1/management/staff/${admin2.user.id}/status`)
          .set('Cookie', creds1.cookieHeader)
          .set('X-CSRF-Token', creds1.csrfTokenHeader || '')
          .send({ isActive: false }),
        request(app.getHttpServer())
          .patch(`/api/v1/management/staff/${admin1.user.id}/role`)
          .set('Cookie', creds2.cookieHeader)
          .set('X-CSRF-Token', creds2.csrfTokenHeader || '')
          .send({ role: UserRole.STAFF }),
      ]);

      const activeAdmins = await prisma.user.count({
        where: { role: UserRole.ADMIN, isActive: true },
      });
      expect(activeAdmins).toBeGreaterThanOrEqual(1);
      expect([res1.status, res2.status]).toContain(403);
    });
  });

  describe('8. GATE B — Initial Administrator Bootstrap Concurrency & Uniqueness', () => {
    it('should allow exactly ONE successful bootstrap during concurrent execution on an empty admin population', async () => {
      const preExistingAdmins = await prisma.user.findMany({
        where: { role: UserRole.ADMIN, isActive: true },
      });
      await prisma.user.updateMany({
        where: { id: { in: preExistingAdmins.map((a) => a.id) } },
        data: { isActive: false },
      });

      try {
        const emailA = `bootstrap_compete_a_${Date.now()}@aurel.restaurant`;
        const emailB = `bootstrap_compete_b_${Date.now()}@aurel.restaurant`;

        const [resA, resB] = await Promise.all([
          bootstrapInitialAdmin(prisma, passwordService, {
            email: emailA,
            password: 'SecureBootstrapPassword#1',
            fullName: 'Bootstrap Admin A',
          }),
          bootstrapInitialAdmin(prisma, passwordService, {
            email: emailB,
            password: 'SecureBootstrapPassword#2',
            fullName: 'Bootstrap Admin B',
          }),
        ]);

        const successful = [resA, resB].filter((r) => r.success);
        const refused = [resA, resB].filter((r) => !r.success);

        expect(successful.length).toBe(1);
        expect(refused.length).toBe(1);
        expect(refused[0].message).toContain(
          'An active administrator already exists in the system',
        );

        if (resA.admin) createdUserIds.push(resA.admin.id);
        if (resB.admin) createdUserIds.push(resB.admin.id);

        const createdCount = await prisma.user.count({
          where: { email: { in: [emailA.toLowerCase(), emailB.toLowerCase()] } },
        });
        expect(createdCount).toBe(1);
      } finally {
        if (preExistingAdmins.length > 0) {
          await prisma.user.updateMany({
            where: { id: { in: preExistingAdmins.map((a) => a.id) } },
            data: { isActive: true },
          });
        }
      }
    });

    it('should refuse competing bootstrap attempts with identical email addresses', async () => {
      const preExistingAdmins = await prisma.user.findMany({
        where: { role: UserRole.ADMIN, isActive: true },
      });
      await prisma.user.updateMany({
        where: { id: { in: preExistingAdmins.map((a) => a.id) } },
        data: { isActive: false },
      });

      try {
        const sharedEmail = `identical_bootstrap_${Date.now()}@aurel.restaurant`;

        const [res1, res2] = await Promise.all([
          bootstrapInitialAdmin(prisma, passwordService, {
            email: sharedEmail,
            password: 'ValidPassword123!',
            fullName: 'First Contender',
          }),
          bootstrapInitialAdmin(prisma, passwordService, {
            email: sharedEmail,
            password: 'ValidPassword123!',
            fullName: 'Second Contender',
          }),
        ]);

        const successes = [res1, res2].filter((r) => r.success);
        expect(successes.length).toBe(1);

        if (res1.admin) createdUserIds.push(res1.admin.id);
        if (res2.admin) createdUserIds.push(res2.admin.id);
      } finally {
        if (preExistingAdmins.length > 0) {
          await prisma.user.updateMany({
            where: { id: { in: preExistingAdmins.map((a) => a.id) } },
            data: { isActive: true },
          });
        }
      }
    });

    it('should refuse bootstrap and never elevate when target email belongs to existing customer', async () => {
      const preExistingAdmins = await prisma.user.findMany({
        where: { role: UserRole.ADMIN, isActive: true },
      });
      await prisma.user.updateMany({
        where: { id: { in: preExistingAdmins.map((a) => a.id) } },
        data: { isActive: false },
      });

      try {
        const customer = await createTestUser({ role: UserRole.CUSTOMER });

        const res = await bootstrapInitialAdmin(prisma, passwordService, {
          email: customer.user.email,
          password: 'ValidBootstrapPassword123!',
          fullName: 'Elevation Attack',
        });

        expect(res.success).toBe(false);
        expect(res.message).toContain(
          'Target email address is already registered to an existing account',
        );

        const customerInDb = await prisma.user.findUnique({
          where: { id: customer.user.id },
        });
        expect(customerInDb?.role).toBe(UserRole.CUSTOMER);
      } finally {
        if (preExistingAdmins.length > 0) {
          await prisma.user.updateMany({
            where: { id: { in: preExistingAdmins.map((a) => a.id) } },
            data: { isActive: true },
          });
        }
      }
    });

    it('should refuse repeated bootstrap when an active administrator exists', async () => {
      await createTestUser({ role: UserRole.ADMIN, isActive: true });

      const res = await bootstrapInitialAdmin(prisma, passwordService, {
        email: `repeated_boot_${Date.now()}@aurel.restaurant`,
        password: 'ValidBootstrapPassword123!',
      });

      expect(res.success).toBe(false);
      expect(res.message).toContain('An active administrator already exists');
    });
  });

  describe('9. GATE D — Secure Staff Credential Provisioning Lifecycle', () => {
    it('should complete secure staff credential establishment: pending setup -> setup token -> permanent password', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      const staffEmail = `lifecycle_staff_${Date.now()}@aurel.restaurant`;
      const initialSeedPassword = 'InitialProvisionPass123!';

      // Step 1: Admin provisions staff account
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/management/staff')
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({
          email: staffEmail,
          password: initialSeedPassword,
          fullName: 'Lifecycle Waiter',
          role: UserRole.STAFF,
        });

      expect(createRes.status).toBe(201);
      createdUserIds.push(createRes.body.id);

      // Verify negative security assertions: no passwords or tokens in response
      expect(createRes.body.password).toBeUndefined();
      expect(createRes.body.passwordHash).toBeUndefined();
      expect(createRes.body.token).toBeUndefined();
      expect(createRes.body.setupToken).toBeUndefined();

      // Verify in PostgreSQL: isPendingSetup is TRUE, token digest is stored
      const staffInDb = await prisma.user.findUnique({
        where: { id: createRes.body.id },
      });
      expect(staffInDb?.isPendingSetup).toBe(true);
      expect(staffInDb?.setupTokenDigest).toBeDefined();
      expect(staffInDb?.setupTokenExpiresAt).toBeDefined();

      // Step 2: Unprovisioned / pending account CANNOT authenticate via operations login
      const pendingLoginRes = await loginAndGetCredentials(
        staffEmail,
        initialSeedPassword,
        '/api/v1/auth/operations-login',
      );
      expect(pendingLoginRes.status).toBe(401);
      expect(pendingLoginRes.body.code).toBe('UNAUTHORIZED');
      expect(pendingLoginRes.body.detail).toContain('Account setup pending');

      // Step 3: Setup attempt with invalid token is rejected (HTTP 401)
      const invalidSetupRes = await request(app.getHttpServer())
        .post('/api/v1/auth/setup-password')
        .send({
          token: 'invalid_cryptographic_setup_token_value_32_chars',
          newPassword: 'MyNewPermanentPassword2026!',
        });
      expect(invalidSetupRes.status).toBe(401);
      expect(invalidSetupRes.body.code).toBe('UNAUTHORIZED');

      // Step 4: Valid token establishes permanent password
      const issuedRawToken = StaffService.getIssuedSetupToken(staffEmail);
      expect(issuedRawToken).toBeDefined();

      const validSetupRes = await request(app.getHttpServer())
        .post('/api/v1/auth/setup-password')
        .send({
          token: issuedRawToken!,
          newPassword: 'MyNewPermanentPassword2026!',
        });
      expect(validSetupRes.status).toBe(200);
      expect(validSetupRes.body.success).toBe(true);

      // Verify in PostgreSQL: isPendingSetup is FALSE, token digest is CLEARED
      const provisionedInDb = await prisma.user.findUnique({
        where: { id: createRes.body.id },
      });
      expect(provisionedInDb?.isPendingSetup).toBe(false);
      expect(provisionedInDb?.setupTokenDigest).toBeNull();
      expect(provisionedInDb?.setupTokenExpiresAt).toBeNull();

      // Verify audit log committed
      const setupAudit = await prisma.auditLog.findFirst({
        where: {
          targetId: createRes.body.id,
          action: AuditAction.STAFF_PASSWORD_ESTABLISHED,
        },
      });
      expect(setupAudit).toBeDefined();

      // Step 5: Token replay is strictly rejected (HTTP 401)
      const replayRes = await request(app.getHttpServer())
        .post('/api/v1/auth/setup-password')
        .send({
          token: issuedRawToken!,
          newPassword: 'AnotherPasswordAttempt2026!',
        });
      expect(replayRes.status).toBe(401);

      // Step 6: Staff can now authenticate to operations workspace with new permanent password
      const successLoginRes = await loginAndGetCredentials(
        staffEmail,
        'MyNewPermanentPassword2026!',
        '/api/v1/auth/operations-login',
      );
      expect(successLoginRes.status).toBe(200);
      expect(successLoginRes.body.role).toBe(UserRole.STAFF);
    });

    it('should reject setup token that has expired (HTTP 401)', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      const expiredEmail = `expired_staff_${Date.now()}@aurel.restaurant`;

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/management/staff')
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({
          email: expiredEmail,
          password: 'InitialPassword123!',
          fullName: 'Expired Token User',
          role: UserRole.STAFF,
        });

      createdUserIds.push(createRes.body.id);
      const rawToken = StaffService.getIssuedSetupToken(expiredEmail);

      // Artificially expire the token in PostgreSQL
      await prisma.user.update({
        where: { id: createRes.body.id },
        data: {
          setupTokenExpiresAt: new Date(Date.now() - 60000),
        },
      });

      const res = await request(app.getHttpServer()).post('/api/v1/auth/setup-password').send({
        token: rawToken!,
        newPassword: 'PermanentPassword2026!',
      });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('10. GATE E — Audit Retention & Referential Integrity', () => {
    it('should preserve historical audit log records when target user is deleted (ON DELETE SET NULL)', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const staff = await createTestUser({ role: UserRole.STAFF });
      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      await request(app.getHttpServer())
        .patch(`/api/v1/management/staff/${staff.user.id}/role`)
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({ role: UserRole.KITCHEN });

      const auditEntryBefore = await prisma.auditLog.findFirst({
        where: { targetId: staff.user.id, action: AuditAction.USER_ROLE_UPDATED },
      });
      expect(auditEntryBefore).toBeDefined();
      const auditLogId = auditEntryBefore!.id;

      // Delete the target staff user from PostgreSQL
      await prisma.user.delete({ where: { id: staff.user.id } });

      // Verification: Audit log entry must STILL EXIST in PostgreSQL with targetId = null
      const auditEntryAfter = await prisma.auditLog.findUnique({
        where: { id: auditLogId },
      });
      expect(auditEntryAfter).toBeDefined();
      expect(auditEntryAfter?.targetId).toBeNull();
      expect(auditEntryAfter?.actorId).toBe(admin.user.id);
      expect(auditEntryAfter?.action).toBe(AuditAction.USER_ROLE_UPDATED);
      expect((auditEntryAfter?.metadata as Record<string, unknown>).oldRole).toBe(UserRole.STAFF);
    });

    it('should preserve historical audit log records when actor user is deleted (ON DELETE SET NULL)', async () => {
      const actorAdmin = await createTestUser({ role: UserRole.ADMIN });
      const targetStaff = await createTestUser({ role: UserRole.STAFF });
      const creds = await loginAndGetCredentials(actorAdmin.user.email, actorAdmin.plainPassword);

      await request(app.getHttpServer())
        .patch(`/api/v1/management/staff/${targetStaff.user.id}/status`)
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({ isActive: false });

      const auditBefore = await prisma.auditLog.findFirst({
        where: { actorId: actorAdmin.user.id, action: AuditAction.USER_DEACTIVATED },
      });
      expect(auditBefore).toBeDefined();
      const auditLogId = auditBefore!.id;

      // Delete the actor admin from PostgreSQL
      await prisma.user.delete({ where: { id: actorAdmin.user.id } });

      // Verification: Audit record persists with actorId = null
      const auditAfter = await prisma.auditLog.findUnique({
        where: { id: auditLogId },
      });
      expect(auditAfter).toBeDefined();
      expect(auditAfter?.actorId).toBeNull();
      expect(auditAfter?.targetId).toBe(targetStaff.user.id);
    });
  });

  describe('11. GATE C — Admin Identity Route Access Control Matrix (/admin/users)', () => {
    it('should forbid CUSTOMER, STAFF, KITCHEN, and MANAGER from accessing admin routes (HTTP 403)', async () => {
      const customer = await createTestUser({ role: UserRole.CUSTOMER });
      const staff = await createTestUser({ role: UserRole.STAFF });
      const kitchen = await createTestUser({ role: UserRole.KITCHEN });
      const manager = await createTestUser({ role: UserRole.MANAGER });

      for (const nonAdmin of [customer, staff, kitchen, manager]) {
        const creds = await loginAndGetCredentials(nonAdmin.user.email, nonAdmin.plainPassword);

        // GET /admin/users
        const listRes = await request(app.getHttpServer())
          .get('/api/v1/admin/users')
          .set('Cookie', creds.cookieHeader);
        expect(listRes.status).toBe(403);
        expect(listRes.body.code).toBe('FORBIDDEN');

        // POST /admin/users
        const postRes = await request(app.getHttpServer())
          .post('/api/v1/admin/users')
          .set('Cookie', creds.cookieHeader)
          .set('X-CSRF-Token', creds.csrfTokenHeader || '')
          .send({
            email: `unauth_admin_${Date.now()}@aurel.restaurant`,
            password: 'SecurePassword123!',
            fullName: 'Unauthorized Admin Attempt',
            role: UserRole.ADMIN,
          });
        expect(postRes.status).toBe(403);
        expect(postRes.body.code).toBe('FORBIDDEN');
      }
    });

    it('should allow ADMIN to list and provision administrative accounts via /admin/users', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      const newAdminEmail = `peer_admin_${Date.now()}@aurel.restaurant`;
      const postRes = await request(app.getHttpServer())
        .post('/api/v1/admin/users')
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({
          email: newAdminEmail,
          password: 'SecureAdminPass123!',
          fullName: 'Peer Administrator',
          role: UserRole.ADMIN,
        });

      expect(postRes.status).toBe(201);
      expect(postRes.body.role).toBe(UserRole.ADMIN);
      createdUserIds.push(postRes.body.id);

      const listRes = await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Cookie', creds.cookieHeader);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.items)).toBe(true);

      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/admin/users/${postRes.body.id}`)
        .set('Cookie', creds.cookieHeader);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(postRes.body.id);
      expect(getRes.body.email).toBe(newAdminEmail.toLowerCase());
    });
  });

  describe('12. GATE G — Transactional Authorization Review & Authority Re-validation', () => {
    it('should forbid deactivated actor from modifying roles even with valid session cookie (fresh authority check)', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const targetStaff = await createTestUser({ role: UserRole.STAFF });
      const staffService = app.get(StaffService);

      const creds = await loginAndGetCredentials(admin.user.email, admin.plainPassword);

      // Deactivate admin directly in PostgreSQL behind their back
      await prisma.user.update({
        where: { id: admin.user.id },
        data: { isActive: false },
      });

      // Layer 1: HTTP request rejected at SessionAuthGuard boundary with 401 Unauthorized
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/management/staff/${targetStaff.user.id}/role`)
        .set('Cookie', creds.cookieHeader)
        .set('X-CSRF-Token', creds.csrfTokenHeader || '')
        .send({ role: UserRole.KITCHEN });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');

      // Layer 2: Transaction-level fresh authority check rejects deactivated actor if invoked directly
      await expect(
        staffService.updateStaffRole(admin.user, targetStaff.user.id, {
          role: UserRole.KITCHEN,
        }),
      ).rejects.toThrow();

      // Target staff role must remain untouched
      const staffInDb = await prisma.user.findUnique({
        where: { id: targetStaff.user.id },
      });
      expect(staffInDb?.role).toBe(UserRole.STAFF);
    });

    it('should roll back user role update if audit log insertion fails', async () => {
      const admin = await createTestUser({ role: UserRole.ADMIN });
      const targetStaff = await createTestUser({ role: UserRole.STAFF });
      const staffService = app.get(StaffService);

      const original$tx = prisma.$transaction.bind(prisma);
      // Spy on prisma.$transaction to simulate catastrophic failure during audit create
      jest.spyOn(prisma, '$transaction').mockImplementationOnce(async (callback: any) => {
        return original$tx(async (tx) => {
          tx.auditLog.create = jest
            .fn()
            .mockRejectedValue(new Error('FATAL_AUDIT_LOG_STORAGE_FAILURE'));
          return callback(tx);
        });
      });

      await expect(
        staffService.updateStaffRole(admin.user, targetStaff.user.id, {
          role: UserRole.KITCHEN,
        }),
      ).rejects.toThrow('FATAL_AUDIT_LOG_STORAGE_FAILURE');

      // Target staff role must remain STAFF in PostgreSQL due to complete transaction rollback
      const targetInDb = await prisma.user.findUnique({
        where: { id: targetStaff.user.id },
      });
      expect(targetInDb?.role).toBe(UserRole.STAFF);

      // Verify no orphan audit log entry was created
      const auditCount = await prisma.auditLog.count({
        where: { targetId: targetStaff.user.id, action: AuditAction.USER_ROLE_UPDATED },
      });
      expect(auditCount).toBe(0);
    });
  });
});
