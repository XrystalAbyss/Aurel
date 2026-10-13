import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Headers,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { User } from '@prisma/client';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { SessionAuthGuard } from '../identity/guards/session-auth.guard';
import { OptionalSessionAuthGuard } from '../identity/guards/optional-session-auth.guard';
import { CsrfGuard } from '../identity/guards/csrf.guard';
import { PermissionsGuard } from '../identity/guards/permissions.guard';
import { Permissions } from '../identity/decorators/permissions.decorator';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { Permission, OrderSummary } from '@aurel/shared-types';

@ApiTags('Commerce & Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OptionalSessionAuthGuard, CsrfGuard)
  @ApiOperation({
    summary: 'Submit a new restaurant order',
    description:
      'Calculates server-authoritative totals in integer paise and atomically persists the order with idempotency guarantee.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Order created successfully',
  })
  @ApiBadRequestResponse({ description: 'Validation failure or modifier constraint violation' })
  async createOrder(@Body() dto: CreateOrderDto, @Req() req: Request): Promise<OrderSummary> {
    const user = (req as unknown as { user?: User }).user;
    return this.ordersService.createOrder(dto, user);
  }

  @Get('operations/queue')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @Permissions(Permission.ORDERS_VIEW)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Retrieve live order queue for Operations workspace',
    description:
      'Returns active and past orders with status and channel filters for kitchen and floor staff.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of orders for operations queue',
  })
  @ApiForbiddenResponse({ description: 'Insufficient permissions (requires orders.view)' })
  async getOperationsQueue(@Query() query: QueryOrdersDto): Promise<OrderSummary[]> {
    return this.ordersService.getOperationsQueue(query);
  }

  @Get(':id')
  @UseGuards(OptionalSessionAuthGuard)
  @ApiOperation({
    summary: 'Lookup order details by ID or Order Number',
    description:
      'Enables real-time order status tracking with guest token authentication and PII sanitization.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order summary with line items and modifiers',
  })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Invalid or missing guest access token' })
  async getOrder(
    @Param('id') id: string,
    @Req() req: Request,
    @Headers('x-order-token') orderTokenHeader?: string,
    @Query('token') orderTokenQuery?: string,
  ): Promise<OrderSummary> {
    const user = (req as unknown as { user?: User }).user;
    const token = orderTokenHeader || orderTokenQuery;
    return this.ordersService.getOrderById(id, user, token);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Transition order through fulfillment state machine',
    description:
      'Updates order status according to kitchen/staff lifecycle boundaries with strict RBAC enforcement.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Updated order summary',
  })
  @ApiBadRequestResponse({ description: 'Illegal state machine transition' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({
    description: 'Actor lacks required role or permission for this transition',
  })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() actor: User,
  ): Promise<OrderSummary> {
    return this.ordersService.updateOrderStatus(id, dto, actor);
  }
}
