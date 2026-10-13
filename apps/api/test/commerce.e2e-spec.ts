import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { configureTrustProxy } from '../src/config/proxy.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/identity/password.service';
import { RateLimiterService } from '../src/identity/rate-limiter.service';
import * as cookieParser from 'cookie-parser';
import { UserRole, FulfillmentChannel, PaymentMode, OrderStatus } from '@aurel/shared-types';

import { SESSION_COOKIE_NAME_DEV, CSRF_COOKIE_NAME } from '../src/identity/cookie.config';

describe('Aurel Commerce & Orders End-to-End Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let rateLimiter: RateLimiterService;

  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];

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

    const currentDb = await prisma.getCurrentDatabaseName();
    expect(currentDb).toBe('aurel_test');
  });

  afterAll(async () => {
    if (createdOrderIds.length > 0) {
      await prisma.orderItemModifier.deleteMany({
        where: { orderItem: { orderId: { in: createdOrderIds } } },
      });
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } },
      });
    }

    if (createdUserIds.length > 0) {
      await prisma.authSession.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
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

  async function createStaffUser(role: UserRole) {
    const email = `e2e_${role.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}@aurel.restaurant`;
    const password = 'SecureStaffPass#2026';
    const passwordHash = await passwordService.hash(password);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        fullName: `E2E ${role} Employee`,
        role,
        isActive: true,
        isPendingSetup: false,
      },
    });

    createdUserIds.push(user.id);
    return { user, plainPassword: password };
  }

  async function loginOperations(email: string, pass: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/operations-login')
      .send({ email, password: pass })
      .expect(200);

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

    const csrfToken = res.headers['x-csrf-token'] as string;
    return {
      sessionCookie,
      csrfCookie,
      csrfToken,
      cookieHeader: [sessionCookie, csrfCookie].filter(Boolean).join('; '),
    };
  }

  describe('GET /api/v1/menu — Catalog Browsing', () => {
    it('returns public restaurant menu categories with items and modifier groups', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/menu').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const firstCat = res.body[0];
      expect(firstCat).toHaveProperty('id');
      expect(firstCat).toHaveProperty('name');
      expect(firstCat).toHaveProperty('slug');
      expect(firstCat).toHaveProperty('items');
      expect(firstCat.items.length).toBeGreaterThan(0);

      const firstItem = firstCat.items[0];
      expect(firstItem).toHaveProperty('id');
      expect(firstItem).toHaveProperty('name');
      expect(firstItem).toHaveProperty('pricePaise');
      expect(typeof firstItem.pricePaise).toBe('number');
      expect(firstItem).toHaveProperty('modifierGroups');
    });
  });

  describe('POST /api/v1/orders — Order Placement, Pricing & Idempotency', () => {
    let testItem: any;
    let requiredOptionId: string | undefined;

    beforeAll(async () => {
      const menuRes = await request(app.getHttpServer()).get('/api/v1/menu').expect(200);
      const allItems = menuRes.body.flatMap((cat: any) => cat.items);
      testItem = allItems.find((i: any) => i.modifierGroups && i.modifierGroups.length > 0);
      if (testItem && testItem.modifierGroups[0]?.options[0]) {
        requiredOptionId = testItem.modifierGroups[0].options[0].id;
      }
    });

    it('creates an order with server-calculated integer paise totals and GST', async () => {
      const idempotencyKey = `e2e-order-${Date.now()}-1`;

      const orderPayload = {
        idempotencyKey,
        fulfillmentChannel: FulfillmentChannel.DELIVERY,
        customerName: 'Marcus Vance',
        customerEmail: 'marcus.vance@example.com',
        customerPhone: '+919876543210',
        deliveryAddress: 'Penthouse 12, Aurel Promenade, Mumbai',
        paymentMode: PaymentMode.DEMO,
        items: [
          {
            menuItemId: testItem.id,
            quantity: 2,
            selectedOptionIds: requiredOptionId ? [requiredOptionId] : [],
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(orderPayload)
        .expect(201);

      createdOrderIds.push(res.body.id);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('orderNumber');
      expect(res.body.orderNumber).toMatch(/^AUR-/);
      expect(res.body.status).toBe(OrderStatus.PLACED);
      expect(res.body.paymentMode).toBe(PaymentMode.DEMO);
      expect(res.body.paymentStatus).toBe('SUCCESS');
      expect(res.body.fulfillmentChannel).toBe(FulfillmentChannel.DELIVERY);
      expect(res.body.deliveryFeePaise).toBe(5000); // ₹50 delivery fee

      const subtotal = res.body.subtotalPaise;
      const expectedTax = Math.round(subtotal * 0.05);
      expect(res.body.taxPaise).toBe(expectedTax);
      expect(res.body.totalPaise).toBe(subtotal + expectedTax + 5000);
    });

    it('submitting identical idempotency key returns the existing order without creating a duplicate', async () => {
      const idempotencyKey = `e2e-order-idem-${Date.now()}`;

      const orderPayload = {
        idempotencyKey,
        fulfillmentChannel: FulfillmentChannel.PICKUP,
        customerName: 'Marcus Vance',
        customerEmail: 'marcus.vance@example.com',
        customerPhone: '+919876543210',
        paymentMode: PaymentMode.CASH,
        items: [
          {
            menuItemId: testItem.id,
            quantity: 1,
            selectedOptionIds: requiredOptionId ? [requiredOptionId] : [],
          },
        ],
      };

      // First submission
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(orderPayload)
        .expect(201);

      createdOrderIds.push(res1.body.id);

      // Duplicate submission
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(orderPayload)
        .expect(201);

      expect(res2.body.id).toBe(res1.body.id);
      expect(res2.body.orderNumber).toBe(res1.body.orderNumber);
      expect(res2.body.totalPaise).toBe(res1.body.totalPaise);

      // Verify in DB that only one record exists with this idempotency key
      const count = await prisma.order.count({
        where: { idempotencyKey },
      });
      expect(count).toBe(1);
    });

    it('rejects duplicate idempotency key when submitted with different payload with HTTP 409 Conflict', async () => {
      const idempotencyKey = `e2e-order-conflict-${Date.now()}`;

      const orderPayload1 = {
        idempotencyKey,
        fulfillmentChannel: FulfillmentChannel.PICKUP,
        customerName: 'Marcus Vance',
        customerEmail: 'marcus.vance@example.com',
        customerPhone: '+919876543210',
        paymentMode: PaymentMode.CASH,
        items: [
          {
            menuItemId: testItem.id,
            quantity: 1,
            selectedOptionIds: requiredOptionId ? [requiredOptionId] : [],
          },
        ],
      };

      const res1 = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(orderPayload1)
        .expect(201);
      createdOrderIds.push(res1.body.id);

      const orderPayload2 = {
        ...orderPayload1,
        fulfillmentChannel: FulfillmentChannel.DELIVERY,
        deliveryAddress: '221B Baker Street',
      };

      const res2 = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(orderPayload2)
        .expect(409);

      expect(res2.body.code).toBe('CONFLICT');
    });

    it('rejects order with HTTP 400 when invalid modifier option is supplied', async () => {
      const idempotencyKey = `e2e-order-invalid-mod-${Date.now()}`;

      const orderPayload = {
        idempotencyKey,
        fulfillmentChannel: FulfillmentChannel.DINE_IN,
        customerName: 'Marcus Vance',
        customerEmail: 'marcus.vance@example.com',
        customerPhone: '+919876543210',
        tableNumber: 'Table 9',
        paymentMode: PaymentMode.DEMO,
        items: [
          {
            menuItemId: testItem.id,
            quantity: 1,
            selectedOptionIds: ['00000000-0000-0000-0000-000000000000'], // Unrelated UUID
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(orderPayload)
        .expect(400);

      expect(['BAD_REQUEST', 'VALIDATION_FAILED']).toContain(res.body.code);
    });

    it('rejects anonymous browser checkout carrying Origin header without required CSRF bootstrap (HTTP 403)', async () => {
      const orderPayload = {
        idempotencyKey: `e2e-csrf-fail-${Date.now()}`,
        fulfillmentChannel: FulfillmentChannel.DINE_IN,
        customerName: 'Browser Guest',
        customerEmail: 'browser.guest@example.com',
        customerPhone: '+919876543299',
        tableNumber: 'Table 9',
        paymentMode: PaymentMode.DEMO,
        items: [
          {
            menuItemId: testItem.id,
            quantity: 1,
            selectedOptionIds: requiredOptionId ? [requiredOptionId] : [],
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Origin', 'http://localhost:5173')
        .send(orderPayload)
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('allows anonymous browser checkout with bootstrapped valid CSRF token and cookie (HTTP 201)', async () => {
      const csrfBootstrap = await request(app.getHttpServer()).get('/api/v1/auth/csrf').expect(200);

      const csrfToken = csrfBootstrap.body.csrfToken;
      const rawCookies = csrfBootstrap.headers['set-cookie'] as unknown as string[];
      const csrfCookie = rawCookies
        .find((c: string) => c.startsWith(`${CSRF_COOKIE_NAME}=`))
        ?.split(';')[0];

      const orderPayload = {
        idempotencyKey: `e2e-csrf-success-${Date.now()}`,
        fulfillmentChannel: FulfillmentChannel.DINE_IN,
        customerName: 'Browser Guest With CSRF',
        customerEmail: 'browser.csrf@example.com',
        customerPhone: '+919876543299',
        tableNumber: 'Table 9',
        paymentMode: PaymentMode.DEMO,
        items: [
          {
            menuItemId: testItem.id,
            quantity: 1,
            selectedOptionIds: requiredOptionId ? [requiredOptionId] : [],
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', csrfCookie || '')
        .set('X-CSRF-Token', csrfToken)
        .send(orderPayload)
        .expect(201);

      createdOrderIds.push(res.body.id);
      expect(res.body.status).toBe(OrderStatus.PLACED);
    });
  });

  describe('Operations Queue & Fulfillment Lifecycle State Machine', () => {
    let orderId: string;
    let guestAccessToken: string;
    let staffCreds: any;
    let kitchenCreds: any;

    beforeAll(async () => {
      // 1. Create STAFF and KITCHEN users
      const staffUser = await createStaffUser(UserRole.STAFF);
      const kitchenUser = await createStaffUser(UserRole.KITCHEN);

      staffCreds = await loginOperations(staffUser.user.email, staffUser.plainPassword);
      kitchenCreds = await loginOperations(kitchenUser.user.email, kitchenUser.plainPassword);

      // 2. Place an order for testing lifecycle
      const menuRes = await request(app.getHttpServer()).get('/api/v1/menu');
      const firstItem = menuRes.body[0].items[0];
      const optId = firstItem.modifierGroups[0]?.options[0]?.id;

      const orderRes = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send({
          idempotencyKey: `e2e-lifecycle-${Date.now()}`,
          fulfillmentChannel: FulfillmentChannel.DINE_IN,
          customerName: 'Sophia Loren',
          customerEmail: 'sophia.loren@example.com',
          customerPhone: '+919876543211',
          tableNumber: 'Table 14',
          paymentMode: PaymentMode.DEMO,
          items: [
            {
              menuItemId: firstItem.id,
              quantity: 1,
              selectedOptionIds: optId ? [optId] : [],
            },
          ],
        })
        .expect(201);

      orderId = orderRes.body.id;
      guestAccessToken = orderRes.body.guestAccessToken;
      createdOrderIds.push(orderId);
    });

    it('rejects unauthenticated requests to /api/v1/orders/operations/queue with 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/orders/operations/queue').expect(401);
    });

    it('allows authenticated STAFF to inspect the operations queue', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/orders/operations/queue')
        .set('Cookie', staffCreds.cookieHeader)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const targetOrder = res.body.find((o: any) => o.id === orderId);
      expect(targetOrder).toBeDefined();
      expect(targetOrder.status).toBe(OrderStatus.PLACED);
    });

    it('rejects authenticated status mutation with cookie but without X-CSRF-Token header (HTTP 403 CSRF_ERROR)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Origin', 'http://localhost:5174')
        .set('Cookie', staffCreds.cookieHeader)
        .send({ status: OrderStatus.ACCEPTED })
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('rejects authenticated status mutation with tampered X-CSRF-Token header (HTTP 403 CSRF_ERROR)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Origin', 'http://localhost:5174')
        .set('Cookie', staffCreds.cookieHeader)
        .set(
          'X-CSRF-Token',
          'tampered-csrf-token.1234567890abcdef1234567890abcdef.1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        )
        .send({ status: OrderStatus.ACCEPTED })
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('rejects authenticated status mutation from untrusted Origin (HTTP 403 FORBIDDEN)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Origin', 'https://malicious-attacker.com')
        .set('Cookie', staffCreds.cookieHeader)
        .set('X-CSRF-Token', staffCreds.csrfToken)
        .send({ status: OrderStatus.ACCEPTED })
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('rejects cookie-bearing status mutation missing Origin when CSRF token is missing (HTTP 403 CSRF_ERROR)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Cookie', staffCreds.cookieHeader)
        .send({ status: OrderStatus.ACCEPTED })
        .expect(403);

      expect(res.body.code).toBe('CSRF_ERROR');
    });

    it('allows STAFF to advance order from PLACED to ACCEPTED with valid CSRF and trusted origin', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Origin', 'http://localhost:5174')
        .set('Cookie', staffCreds.cookieHeader)
        .set('X-CSRF-Token', staffCreds.csrfToken)
        .send({ status: OrderStatus.ACCEPTED })
        .expect(200);

      expect(res.body.status).toBe(OrderStatus.ACCEPTED);
    });

    it('allows KITCHEN to advance order from ACCEPTED to PREPARING with valid CSRF and trusted origin', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Origin', 'http://localhost:5174')
        .set('Cookie', kitchenCreds.cookieHeader)
        .set('X-CSRF-Token', kitchenCreds.csrfToken)
        .send({ status: OrderStatus.PREPARING })
        .expect(200);

      expect(res.body.status).toBe(OrderStatus.PREPARING);
    });

    it('allows KITCHEN to advance order from PREPARING to READY with valid CSRF and trusted origin', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Origin', 'http://localhost:5174')
        .set('Cookie', kitchenCreds.cookieHeader)
        .set('X-CSRF-Token', kitchenCreds.csrfToken)
        .send({ status: OrderStatus.READY })
        .expect(200);

      expect(res.body.status).toBe(OrderStatus.READY);
    });

    it('strictly forbids KITCHEN from marking order as SERVED (lacks orders.serve)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Origin', 'http://localhost:5174')
        .set('Cookie', kitchenCreds.cookieHeader)
        .set('X-CSRF-Token', kitchenCreds.csrfToken)
        .send({ status: OrderStatus.SERVED })
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('allows STAFF to mark order as SERVED with valid CSRF and trusted origin', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Origin', 'http://localhost:5174')
        .set('Cookie', staffCreds.cookieHeader)
        .set('X-CSRF-Token', staffCreds.csrfToken)
        .send({ status: OrderStatus.SERVED })
        .expect(200);

      expect(res.body.status).toBe(OrderStatus.SERVED);
    });

    it('strictly forbids guest order lookup without order token (HTTP 403)', async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/orders/${orderId}`).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('allows guest to track order status using X-Order-Token with masked customer PII', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}`)
        .set('X-Order-Token', guestAccessToken)
        .expect(200);

      expect(res.body.id).toBe(orderId);
      expect(res.body.status).toBe(OrderStatus.SERVED);
      expect(res.body.customerEmail).toBe('s***n@example.com');
      expect(res.body.customerPhone).toBe('***-***-3211');
    });

    it('allows authenticated STAFF to inspect order details with unmasked customer PII', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}`)
        .set('Cookie', staffCreds.cookieHeader)
        .expect(200);

      expect(res.body.id).toBe(orderId);
      expect(res.body.customerEmail).toBe('sophia.loren@example.com');
      expect(res.body.customerPhone).toBe('+919876543211');
    });
  });
});
