import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import {
  OrderSummary,
  OrderStatus,
  FulfillmentChannel,
  PaymentMode,
  PaymentStatus,
  Permission,
  hasPermission,
  UserRole,
  ErrorCode,
} from '@aurel/shared-types';
import { User, Order, OrderItem, OrderItemModifier } from '@prisma/client';

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '***@***.com';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

function maskPhone(phone: string): string {
  if (!phone || phone.length <= 4) return '***';
  const lastFour = phone.slice(-4);
  return `***-***-${lastFour}`;
}

function computeRequestFingerprint(dto: CreateOrderDto): string {
  const canonicalPayload = {
    channel: dto.fulfillmentChannel,
    customerName: dto.customerName.trim().toLowerCase(),
    customerEmail: dto.customerEmail.trim().toLowerCase(),
    customerPhone: dto.customerPhone.trim(),
    tableNumber: dto.tableNumber?.trim() || null,
    deliveryAddress: dto.deliveryAddress?.trim() || null,
    specialInstructions: dto.specialInstructions?.trim() || null,
    paymentMode: dto.paymentMode,
    items: dto.items
      .map((i) => ({
        menuItemId: i.menuItemId,
        quantity: i.quantity,
        selectedOptionIds: (i.selectedOptionIds || []).slice().sort(),
      }))
      .sort((a, b) => a.menuItemId.localeCompare(b.menuItemId)),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
}

type OrderWithItems = Order & {
  items: (OrderItem & {
    modifiers: OrderItemModifier[];
  })[];
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates and persists a customer order with server-authoritative integer paise pricing
   * and idempotency enforcement.
   */
  async createOrder(dto: CreateOrderDto, customerUser?: User): Promise<OrderSummary> {
    const requestFingerprint = computeRequestFingerprint(dto);

    // 1. Idempotency guard: Return existing order if identical key was already submitted
    const existingOrder = await this.prisma.order.findUnique({
      where: { idempotencyKey: dto.idempotencyKey.trim() },
      include: {
        items: {
          include: {
            modifiers: true,
          },
        },
      },
    });

    if (existingOrder) {
      if (
        existingOrder.requestFingerprint &&
        existingOrder.requestFingerprint !== requestFingerprint
      ) {
        this.logger.warn(
          `Idempotency conflict: key '${dto.idempotencyKey}' reused with different request payload`,
        );
        throw new ConflictException({
          message: 'Idempotency key was previously used with a different order request payload.',
          code: ErrorCode.CONFLICT,
          error: 'Conflict',
        });
      }

      this.logger.log(`Idempotent order lookup matched: ${existingOrder.orderNumber}`);
      return this.mapToOrderSummary(existingOrder, undefined, false);
    }

    // 2. Validate channel-specific requirements
    if (dto.fulfillmentChannel === FulfillmentChannel.DELIVERY && !dto.deliveryAddress?.trim()) {
      throw new BadRequestException({
        message: 'Delivery address is required when fulfillment channel is DELIVERY.',
        code: ErrorCode.VALIDATION_FAILED,
        error: 'Bad Request',
      });
    }

    if (dto.fulfillmentChannel === FulfillmentChannel.DINE_IN && !dto.tableNumber?.trim()) {
      throw new BadRequestException({
        message: 'Table number is required when fulfillment channel is DINE_IN.',
        code: ErrorCode.VALIDATION_FAILED,
        error: 'Bad Request',
      });
    }

    // 3. Load and validate all requested menu items and their modifier groups from PostgreSQL
    const itemIds = [...new Set(dto.items.map((i) => i.menuItemId))];
    const dbItems = await this.prisma.menuItem.findMany({
      where: { id: { in: itemIds } },
      include: {
        modifierGroups: {
          include: {
            options: true,
          },
        },
      },
    });

    const dbItemMap = new Map(dbItems.map((item) => [item.id, item]));

    for (const reqItem of dto.items) {
      const dbItem = dbItemMap.get(reqItem.menuItemId);
      if (!dbItem) {
        throw new BadRequestException({
          message: `Menu item with ID '${reqItem.menuItemId}' does not exist.`,
          code: ErrorCode.NOT_FOUND,
          error: 'Bad Request',
        });
      }

      if (!dbItem.isAvailable) {
        throw new BadRequestException({
          message: `Item '${dbItem.name}' is currently unavailable (86'd).`,
          code: ErrorCode.BAD_REQUEST,
          error: 'Bad Request',
        });
      }

      // Validate modifier selections against group constraints
      const selectedOptionIds = reqItem.selectedOptionIds || [];
      const optionMap = new Map(
        dbItem.modifierGroups.flatMap((g) => g.options.map((opt) => [opt.id, { opt, group: g }])),
      );

      // Verify all selected options belong to this item
      for (const optId of selectedOptionIds) {
        if (!optionMap.has(optId)) {
          throw new BadRequestException({
            message: `Modifier option '${optId}' does not belong to menu item '${dbItem.name}'.`,
            code: ErrorCode.BAD_REQUEST,
            error: 'Bad Request',
          });
        }
      }

      // Validate min and max constraints per group
      for (const group of dbItem.modifierGroups) {
        const selectedInGroup = selectedOptionIds.filter((id) =>
          group.options.some((o) => o.id === id),
        );

        if (selectedInGroup.length < group.minSelections) {
          throw new BadRequestException({
            message: `Modifier group '${group.name}' on '${dbItem.name}' requires at least ${group.minSelections} selection(s).`,
            code: ErrorCode.BAD_REQUEST,
            error: 'Bad Request',
          });
        }

        if (selectedInGroup.length > group.maxSelections) {
          throw new BadRequestException({
            message: `Modifier group '${group.name}' on '${dbItem.name}' allows at most ${group.maxSelections} selection(s).`,
            code: ErrorCode.BAD_REQUEST,
            error: 'Bad Request',
          });
        }
      }
    }

    // 4. Server-authoritative calculation in integer paise
    let subtotalPaise = 0;
    const computedItems: Array<{
      menuItemId: string;
      name: string;
      unitPricePaise: number;
      quantity: number;
      lineTotalPaise: number;
      modifiers: Array<{
        optionId: string;
        name: string;
        pricePaise: number;
      }>;
    }> = [];

    for (const reqItem of dto.items) {
      const dbItem = dbItemMap.get(reqItem.menuItemId)!;
      const selectedOptionIds = reqItem.selectedOptionIds || [];

      const modifierSnapshots: Array<{ optionId: string; name: string; pricePaise: number }> = [];
      let modifierSumPaise = 0;

      for (const group of dbItem.modifierGroups) {
        for (const opt of group.options) {
          if (selectedOptionIds.includes(opt.id)) {
            modifierSnapshots.push({
              optionId: opt.id,
              name: `${group.name}: ${opt.name}`,
              pricePaise: opt.pricePaise,
            });
            modifierSumPaise += opt.pricePaise;
          }
        }
      }

      const unitPricePaise = dbItem.pricePaise + modifierSumPaise;
      const lineTotalPaise = unitPricePaise * reqItem.quantity;
      subtotalPaise += lineTotalPaise;

      computedItems.push({
        menuItemId: dbItem.id,
        name: dbItem.name,
        unitPricePaise,
        quantity: reqItem.quantity,
        lineTotalPaise,
        modifiers: modifierSnapshots,
      });
    }

    // Illustrative Demo GST rate (configurable, defaults to 500 bps = 5.00%)
    const demoTaxRateBps = parseInt(process.env.DEMO_TAX_RATE_BPS || '500', 10);
    const taxRate = demoTaxRateBps / 10000;
    const taxPaise = Math.round(subtotalPaise * taxRate);

    // Delivery fee: ₹50.00 (5000 paise) for DELIVERY, ₹0 for PICKUP / DINE_IN
    const deliveryFeePaise = dto.fulfillmentChannel === FulfillmentChannel.DELIVERY ? 5000 : 0;

    const totalPaise = subtotalPaise + taxPaise + deliveryFeePaise;

    // Payment state for MVP: DEMO immediately marks SUCCESS, CASH marks INITIATED
    const paymentStatus =
      dto.paymentMode === PaymentMode.DEMO ? PaymentStatus.SUCCESS : PaymentStatus.INITIATED;

    // Human-friendly unique order reference: AUR-YYYYMMDD-XXXX
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString();
    const orderNumber = `AUR-${dateStr}-${randomSuffix}`;

    // Generate high-entropy guest access token for privacy-safe tracking
    const rawGuestToken = crypto.randomBytes(32).toString('hex');
    const guestTokenHash = crypto.createHash('sha256').update(rawGuestToken).digest('hex');

    // 5. Atomic PostgreSQL persistence
    const createdOrder = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber,
          idempotencyKey: dto.idempotencyKey.trim(),
          guestTokenHash,
          requestFingerprint,
          customerId: customerUser?.id || null,
          customerName: dto.customerName.trim(),
          customerEmail: dto.customerEmail.trim().toLowerCase(),
          customerPhone: dto.customerPhone.trim(),
          fulfillmentChannel: dto.fulfillmentChannel,
          deliveryAddress: dto.deliveryAddress?.trim() || null,
          tableNumber: dto.tableNumber?.trim() || null,
          specialInstructions: dto.specialInstructions?.trim() || null,
          status: OrderStatus.PLACED,
          paymentMode: dto.paymentMode,
          paymentStatus,
          subtotalPaise,
          taxPaise,
          deliveryFeePaise,
          totalPaise,
        },
      });

      for (const item of computedItems) {
        const orderItem = await tx.orderItem.create({
          data: {
            orderId: order.id,
            menuItemId: item.menuItemId,
            name: item.name,
            unitPricePaise: item.unitPricePaise,
            quantity: item.quantity,
            lineTotalPaise: item.lineTotalPaise,
          },
        });

        for (const mod of item.modifiers) {
          await tx.orderItemModifier.create({
            data: {
              orderItemId: orderItem.id,
              optionId: mod.optionId,
              name: mod.name,
              pricePaise: mod.pricePaise,
            },
          });
        }
      }

      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          items: {
            include: {
              modifiers: true,
            },
          },
        },
      });
    });

    this.logger.log(
      `Order placed successfully: ${createdOrder.orderNumber} (Total: ₹${(totalPaise / 100).toFixed(2)}, Channel: ${createdOrder.fulfillmentChannel})`,
    );

    return this.mapToOrderSummary(createdOrder, rawGuestToken, false);
  }

  /**
   * Retrieves an order by ID or order number for live tracking with privacy controls.
   */
  async getOrderById(identifier: string, actor?: User, guestToken?: string): Promise<OrderSummary> {
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id: identifier }, { orderNumber: identifier }],
      },
      include: {
        items: {
          include: {
            modifiers: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException({
        message: 'Order not found.',
        code: ErrorCode.NOT_FOUND,
        error: 'Not Found',
      });
    }

    const isStaff = !!(actor && hasPermission(actor.role as UserRole, Permission.ORDERS_VIEW));
    const isOwner = !!(actor && actor.role === UserRole.CUSTOMER && order.customerId === actor.id);

    let isGuestAuthorized = false;
    if (guestToken && order.guestTokenHash) {
      const incomingHash = crypto.createHash('sha256').update(guestToken.trim()).digest('hex');
      if (
        incomingHash.length === order.guestTokenHash.length &&
        crypto.timingSafeEqual(Buffer.from(incomingHash), Buffer.from(order.guestTokenHash))
      ) {
        isGuestAuthorized = true;
      }
    }

    if (!isStaff && !isOwner && !isGuestAuthorized) {
      throw new ForbiddenException({
        message: 'Access forbidden: Valid guest access token or staff authorization is required.',
        code: ErrorCode.FORBIDDEN,
        error: 'Forbidden',
      });
    }

    return this.mapToOrderSummary(order, isGuestAuthorized ? guestToken : undefined, isStaff);
  }

  /**
   * Retrieves orders for Operations workspace with status and channel filters.
   */
  async getOperationsQueue(query: QueryOrdersDto): Promise<OrderSummary[]> {
    const where: Record<string, unknown> = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.fulfillmentChannel) {
      where.fulfillmentChannel = query.fulfillmentChannel;
    }

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, query.limit || 50),
      skip: ((query.page || 1) - 1) * (query.limit || 50),
      include: {
        items: {
          include: {
            modifiers: true,
          },
        },
      },
    });

    return orders.map((o) => this.mapToOrderSummary(o, undefined, true));
  }

  /**
   * Mutates an order status through the restaurant fulfillment state machine.
   * Enforces role-based permissions at each transition boundary.
   */
  async updateOrderStatus(
    orderId: string,
    dto: UpdateOrderStatusDto,
    actor: User,
  ): Promise<OrderSummary> {
    const actorRole = actor.role as UserRole;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            modifiers: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException({
        message: 'Order not found.',
        code: ErrorCode.NOT_FOUND,
        error: 'Not Found',
      });
    }

    const currentStatus = order.status;
    const targetStatus = dto.status;

    if (currentStatus === targetStatus) {
      return this.mapToOrderSummary(order);
    }

    // Fulfillment State Machine Transition Map
    const validTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.PLACED]: [OrderStatus.ACCEPTED, OrderStatus.REJECTED, OrderStatus.CANCELLED],
      [OrderStatus.ACCEPTED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
      [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
      [OrderStatus.READY]: [
        OrderStatus.DISPATCHED,
        OrderStatus.DELIVERED,
        OrderStatus.COLLECTED,
        OrderStatus.SERVED,
        OrderStatus.CANCELLED,
      ],
      [OrderStatus.DISPATCHED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      [OrderStatus.DELIVERED]: [],
      [OrderStatus.COLLECTED]: [],
      [OrderStatus.SERVED]: [],
      [OrderStatus.REJECTED]: [],
      [OrderStatus.CANCELLED]: [],
    };

    const allowedNextStatuses = validTransitions[currentStatus] || [];
    if (!allowedNextStatuses.includes(targetStatus)) {
      throw new BadRequestException({
        message: `Invalid order status transition from '${currentStatus}' to '${targetStatus}'.`,
        code: ErrorCode.BAD_REQUEST,
        error: 'Bad Request',
      });
    }

    // Role Permission Enforcement:
    // - PREPARING / READY: Requires ORDERS_PREPARE (KITCHEN, MANAGER, ADMIN)
    // - ACCEPTED / DISPATCHED / DELIVERED / COLLECTED / SERVED: Requires ORDERS_SERVE (STAFF, MANAGER, ADMIN)
    // - REJECTED / CANCELLED: Requires MANAGER or ADMIN
    if (targetStatus === OrderStatus.PREPARING || targetStatus === OrderStatus.READY) {
      if (!hasPermission(actorRole, Permission.ORDERS_PREPARE)) {
        throw new ForbiddenException({
          message: `Actor lacks required permission '${Permission.ORDERS_PREPARE}' to prepare or mark food ready.`,
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }
    } else if (
      targetStatus === OrderStatus.ACCEPTED ||
      targetStatus === OrderStatus.DISPATCHED ||
      targetStatus === OrderStatus.DELIVERED ||
      targetStatus === OrderStatus.COLLECTED ||
      targetStatus === OrderStatus.SERVED
    ) {
      if (!hasPermission(actorRole, Permission.ORDERS_SERVE)) {
        throw new ForbiddenException({
          message: `Actor lacks required permission '${Permission.ORDERS_SERVE}' to accept, dispatch, or serve orders.`,
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }
    } else if (targetStatus === OrderStatus.REJECTED || targetStatus === OrderStatus.CANCELLED) {
      if (actorRole !== UserRole.MANAGER && actorRole !== UserRole.ADMIN) {
        throw new ForbiddenException({
          message: 'Only managers and administrators can cancel or reject placed orders.',
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: targetStatus },
      include: {
        items: {
          include: {
            modifiers: true,
          },
        },
      },
    });

    this.logger.log(
      `Order ${updated.orderNumber} status transitioned: ${currentStatus} -> ${targetStatus} by actor ${actor.id} (${actor.role})`,
    );

    return this.mapToOrderSummary(updated, undefined, true);
  }

  private mapToOrderSummary(
    order: OrderWithItems,
    guestAccessToken?: string,
    isStaff = true,
  ): OrderSummary {
    const demoTaxRateBps = parseInt(process.env.DEMO_TAX_RATE_BPS || '500', 10);
    const taxLabel = `Illustrative GST (${(demoTaxRateBps / 100).toFixed(1)}% demo rate)`;

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      idempotencyKey: order.idempotencyKey,
      guestAccessToken,
      customerId: order.customerId,
      customerName: order.customerName,
      customerEmail: isStaff ? order.customerEmail : maskEmail(order.customerEmail),
      customerPhone: isStaff ? order.customerPhone : maskPhone(order.customerPhone),
      fulfillmentChannel: order.fulfillmentChannel as FulfillmentChannel,
      deliveryAddress: order.deliveryAddress,
      tableNumber: order.tableNumber,
      specialInstructions: order.specialInstructions,
      status: order.status as OrderStatus,
      paymentMode: order.paymentMode as PaymentMode,
      paymentStatus: order.paymentStatus as PaymentStatus,
      subtotalPaise: order.subtotalPaise,
      taxPaise: order.taxPaise,
      taxLabel,
      deliveryFeePaise: order.deliveryFeePaise,
      totalPaise: order.totalPaise,
      items: order.items.map((i) => ({
        id: i.id,
        menuItemId: i.menuItemId,
        name: i.name,
        unitPricePaise: i.unitPricePaise,
        quantity: i.quantity,
        modifiers: i.modifiers.map((m) => ({
          optionId: m.optionId,
          name: m.name,
          pricePaise: m.pricePaise,
        })),
        lineTotalPaise: i.lineTotalPaise,
      })),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
