import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import * as crypto from 'crypto';
import { FulfillmentChannel, PaymentMode, OrderStatus, UserRole } from '@aurel/shared-types';
import { User } from '@prisma/client';

describe('OrdersService', () => {
  let service: OrdersService;
  let mockPrisma: any;

  const sampleDbItem = {
    id: 'item-uuid-1',
    name: 'Dry-Aged Tenderloin Tagliata',
    pricePaise: 145000, // ₹1,450
    isAvailable: true,
    modifierGroups: [
      {
        id: 'group-temp',
        name: 'Cooking Temperature',
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: 'opt-rare', name: 'Rare', pricePaise: 0 },
          { id: 'opt-med-rare', name: 'Medium Rare', pricePaise: 0 },
        ],
      },
      {
        id: 'group-side',
        name: 'Chef Side Selection',
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: 'opt-mash', name: 'Truffle Pomme Purée', pricePaise: 0 },
          { id: 'opt-broc', name: 'Charred Broccolini', pricePaise: 10000 }, // +₹100
        ],
      },
    ],
  };

  beforeEach(async () => {
    mockPrisma = {
      order: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      orderItem: {
        create: jest.fn(),
      },
      orderItemModifier: {
        create: jest.fn(),
      },
      menuItem: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (cb) => cb(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('createOrder - Price Calculation & Idempotency', () => {
    it('calculates exact server-authoritative totals in integer paise and returns order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null); // No previous idempotent hit
      mockPrisma.menuItem.findMany.mockResolvedValue([sampleDbItem]);

      const mockCreatedOrder = {
        id: 'ord-uuid-1',
        orderNumber: 'AUR-20261013-1001',
        idempotencyKey: 'idem-key-12345',
        customerId: null,
        customerName: 'Aria Stark',
        customerEmail: 'aria@example.com',
        customerPhone: '+919876543210',
        fulfillmentChannel: FulfillmentChannel.DELIVERY,
        deliveryAddress: 'Winterfell Suite 101',
        tableNumber: null,
        specialInstructions: 'Extra napkins',
        status: OrderStatus.PLACED,
        paymentMode: PaymentMode.DEMO,
        paymentStatus: 'SUCCESS',
        subtotalPaise: 310000, // 2 * (145000 + 10000) = 310000
        taxPaise: 15500, // 5% of 310000 = 15500
        deliveryFeePaise: 5000, // ₹50 delivery fee
        totalPaise: 330500, // 310000 + 15500 + 5000 = 330500
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: 'item-row-1',
            menuItemId: 'item-uuid-1',
            name: 'Dry-Aged Tenderloin Tagliata',
            unitPricePaise: 155000,
            quantity: 2,
            lineTotalPaise: 310000,
            modifiers: [
              { optionId: 'opt-med-rare', name: 'Cooking Temperature: Medium Rare', pricePaise: 0 },
              {
                optionId: 'opt-broc',
                name: 'Chef Side Selection: Charred Broccolini',
                pricePaise: 10000,
              },
            ],
          },
        ],
      };

      mockPrisma.order.create.mockResolvedValue(mockCreatedOrder);
      mockPrisma.orderItem.create.mockResolvedValue({ id: 'item-row-1' });
      mockPrisma.orderItemModifier.create.mockResolvedValue({ id: 'mod-1' });
      mockPrisma.order.findUniqueOrThrow.mockResolvedValue(mockCreatedOrder);

      const result = await service.createOrder({
        idempotencyKey: 'idem-key-12345',
        fulfillmentChannel: FulfillmentChannel.DELIVERY,
        customerName: 'Aria Stark',
        customerEmail: 'aria@example.com',
        customerPhone: '+919876543210',
        deliveryAddress: 'Winterfell Suite 101',
        paymentMode: PaymentMode.DEMO,
        items: [
          {
            menuItemId: 'item-uuid-1',
            quantity: 2,
            selectedOptionIds: ['opt-med-rare', 'opt-broc'],
          },
        ],
      });

      expect(result.idempotencyKey).toBe('idem-key-12345');
      expect(result.subtotalPaise).toBe(310000);
      expect(result.taxPaise).toBe(15500);
      expect(result.deliveryFeePaise).toBe(5000);
      expect(result.totalPaise).toBe(330500);
    });

    it('returns existing cached order when idempotency key is replayed without duplicate creation', async () => {
      const existingOrder = {
        id: 'ord-uuid-1',
        orderNumber: 'AUR-20261013-1001',
        idempotencyKey: 'idem-key-duplicate',
        customerName: 'Aria Stark',
        customerEmail: 'aria@example.com',
        customerPhone: '+919876543210',
        fulfillmentChannel: FulfillmentChannel.DINE_IN,
        status: OrderStatus.PLACED,
        paymentMode: PaymentMode.CASH,
        paymentStatus: 'INITIATED',
        subtotalPaise: 145000,
        taxPaise: 7250,
        deliveryFeePaise: 0,
        totalPaise: 152250,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
      };

      mockPrisma.order.findUnique.mockResolvedValue(existingOrder);

      const result = await service.createOrder({
        idempotencyKey: 'idem-key-duplicate',
        fulfillmentChannel: FulfillmentChannel.DINE_IN,
        customerName: 'Aria Stark',
        customerEmail: 'aria@example.com',
        customerPhone: '+919876543210',
        tableNumber: 'Table 4',
        paymentMode: PaymentMode.CASH,
        items: [{ menuItemId: 'item-uuid-1', quantity: 1 }],
      });

      expect(result.idempotencyKey).toBe('idem-key-duplicate');
      expect(mockPrisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects order with BadRequestException when modifier group minimum selection is violated', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.menuItem.findMany.mockResolvedValue([sampleDbItem]);

      await expect(
        service.createOrder({
          idempotencyKey: 'idem-key-bad-mod',
          fulfillmentChannel: FulfillmentChannel.PICKUP,
          customerName: 'Aria Stark',
          customerEmail: 'aria@example.com',
          customerPhone: '+919876543210',
          paymentMode: PaymentMode.DEMO,
          items: [
            {
              menuItemId: 'item-uuid-1',
              quantity: 1,
              selectedOptionIds: [], // Missing required temperature and side!
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate idempotency key when submitted with different payload (ConflictException)', async () => {
      const existingOrder = {
        id: 'ord-uuid-1',
        orderNumber: 'AUR-20261013-1001',
        idempotencyKey: 'idem-key-duplicate',
        requestFingerprint: 'existing-different-fingerprint-sha256',
        customerName: 'Aria Stark',
        customerEmail: 'aria@example.com',
        customerPhone: '+919876543210',
        fulfillmentChannel: FulfillmentChannel.DINE_IN,
        status: OrderStatus.PLACED,
        paymentMode: PaymentMode.CASH,
        paymentStatus: 'INITIATED',
        subtotalPaise: 145000,
        taxPaise: 7250,
        deliveryFeePaise: 0,
        totalPaise: 152250,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
      };

      mockPrisma.order.findUnique.mockResolvedValue(existingOrder);

      await expect(
        service.createOrder({
          idempotencyKey: 'idem-key-duplicate',
          fulfillmentChannel: FulfillmentChannel.DINE_IN,
          customerName: 'Aria Stark',
          customerEmail: 'aria@example.com',
          customerPhone: '+919876543210',
          tableNumber: 'Table 9',
          paymentMode: PaymentMode.CASH,
          items: [{ menuItemId: 'item-uuid-1', quantity: 1 }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects order with BadRequestException when menu item is 86 (unavailable)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.menuItem.findMany.mockResolvedValue([{ ...sampleDbItem, isAvailable: false }]);

      await expect(
        service.createOrder({
          idempotencyKey: 'idem-key-86',
          fulfillmentChannel: FulfillmentChannel.PICKUP,
          customerName: 'Aria Stark',
          customerEmail: 'aria@example.com',
          customerPhone: '+919876543210',
          paymentMode: PaymentMode.DEMO,
          items: [
            {
              menuItemId: 'item-uuid-1',
              quantity: 1,
              selectedOptionIds: ['opt-med-rare', 'opt-mash'],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getOrderById - Privacy & Ownership Enforcement', () => {
    const rawToken = 'secret-guest-token-1234567890abcdef1234567890abcdef';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const sampleOrder = {
      id: 'ord-uuid-private',
      orderNumber: 'AUR-20261013-9999',
      idempotencyKey: 'key-priv',
      guestTokenHash: tokenHash,
      customerName: 'Elena Rostova',
      customerEmail: 'elena.rostova@example.com',
      customerPhone: '+919876543210',
      fulfillmentChannel: FulfillmentChannel.DELIVERY,
      deliveryAddress: '42 Royal Crescent, Flat 3B',
      status: OrderStatus.PLACED,
      paymentMode: PaymentMode.DEMO,
      paymentStatus: 'SUCCESS',
      subtotalPaise: 200000,
      taxPaise: 10000,
      deliveryFeePaise: 5000,
      totalPaise: 215000,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
    };

    it('masks customer email and phone when retrieved by guest with valid token', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(sampleOrder);

      const result = await service.getOrderById('ord-uuid-private', undefined, rawToken);

      expect(result.id).toBe('ord-uuid-private');
      expect(result.customerEmail).toBe('e***a@example.com');
      expect(result.customerPhone).toBe('***-***-3210');
      expect(result.taxLabel).toContain('Illustrative GST');
    });

    it('denies order retrieval with ForbiddenException when guest token is invalid', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(sampleOrder);

      await expect(
        service.getOrderById('ord-uuid-private', undefined, 'invalid-guest-token'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('denies order retrieval with ForbiddenException when guest token is omitted', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(sampleOrder);

      await expect(service.getOrderById('ord-uuid-private')).rejects.toThrow(ForbiddenException);
    });

    it('returns unmasked customer PII when order is looked up by authorized staff', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(sampleOrder);

      const staffActor = { id: 'staff-uuid-1', role: UserRole.STAFF } as User;

      const result = await service.getOrderById('ord-uuid-private', staffActor);

      expect(result.customerEmail).toBe('elena.rostova@example.com');
      expect(result.customerPhone).toBe('+919876543210');
    });
  });

  describe('updateOrderStatus - Fulfillment State Machine & RBAC', () => {
    const existingOrder = {
      id: 'ord-uuid-1',
      orderNumber: 'AUR-20261013-1001',
      idempotencyKey: 'key-1',
      status: OrderStatus.PLACED,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
    };

    it('allows STAFF to advance order from PLACED to ACCEPTED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(existingOrder);
      mockPrisma.order.update.mockResolvedValue({
        ...existingOrder,
        status: OrderStatus.ACCEPTED,
      });

      const staffActor = { id: 'staff-1', role: UserRole.STAFF } as User;

      const result = await service.updateOrderStatus(
        'ord-uuid-1',
        { status: OrderStatus.ACCEPTED },
        staffActor,
      );

      expect(result.status).toBe(OrderStatus.ACCEPTED);
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: OrderStatus.ACCEPTED },
        }),
      );
    });

    it('allows KITCHEN to advance order from ACCEPTED to PREPARING', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...existingOrder,
        status: OrderStatus.ACCEPTED,
      });
      mockPrisma.order.update.mockResolvedValue({
        ...existingOrder,
        status: OrderStatus.PREPARING,
      });

      const kitchenActor = { id: 'kitchen-1', role: UserRole.KITCHEN } as User;

      const result = await service.updateOrderStatus(
        'ord-uuid-1',
        { status: OrderStatus.PREPARING },
        kitchenActor,
      );

      expect(result.status).toBe(OrderStatus.PREPARING);
    });

    it('strictly denies KITCHEN from marking order as SERVED (insufficient permissions)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...existingOrder,
        status: OrderStatus.READY,
      });

      const kitchenActor = { id: 'kitchen-1', role: UserRole.KITCHEN } as User;

      await expect(
        service.updateOrderStatus('ord-uuid-1', { status: OrderStatus.SERVED }, kitchenActor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects illegal status transition jumps (e.g. PLACED -> DELIVERED)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(existingOrder);

      const staffActor = { id: 'staff-1', role: UserRole.STAFF } as User;

      await expect(
        service.updateOrderStatus('ord-uuid-1', { status: OrderStatus.DELIVERED }, staffActor),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
