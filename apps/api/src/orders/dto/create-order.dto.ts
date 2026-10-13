import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  Max,
  ArrayMinSize,
  MinLength,
  MaxLength,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  FulfillmentChannel,
  PaymentMode,
  CreateOrderRequest,
  CreateOrderItemRequest,
} from '@aurel/shared-types';

export class CreateOrderItemDto implements CreateOrderItemRequest {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Unique identifier of the menu item',
  })
  @IsUUID('4', { message: 'menuItemId must be a valid UUID' })
  menuItemId: string;

  @ApiProperty({
    example: 2,
    description: 'Quantity of this item to prepare (1-50)',
  })
  @IsInt({ message: 'Quantity must be an integer' })
  @Min(1, { message: 'Quantity must be at least 1' })
  @Max(50, { message: 'Quantity must not exceed 50 per line' })
  quantity: number;

  @ApiPropertyOptional({
    example: ['660e8400-e29b-41d4-a716-446655440000'],
    description: 'Selected modifier option IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Each modifier option must be a valid UUID' })
  selectedOptionIds?: string[];
}

export class CreateOrderDto implements CreateOrderRequest {
  @ApiProperty({
    example: 'ord-idem-20261013-99482',
    description: 'Client-generated idempotency key to prevent double checkout',
  })
  @IsString()
  @MinLength(8, { message: 'Idempotency key must be at least 8 characters' })
  @MaxLength(128, { message: 'Idempotency key must not exceed 128 characters' })
  idempotencyKey: string;

  @ApiProperty({
    example: FulfillmentChannel.DINE_IN,
    enum: FulfillmentChannel,
    description: 'Fulfillment channel for the dining experience',
  })
  @IsEnum(FulfillmentChannel, { message: 'Invalid fulfillment channel' })
  fulfillmentChannel: FulfillmentChannel;

  @ApiProperty({
    example: 'Elena Rostova',
    description: 'Guest or customer contact name',
  })
  @IsString()
  @MinLength(2, { message: 'Customer name must be at least 2 characters' })
  @MaxLength(100, { message: 'Customer name must not exceed 100 characters' })
  customerName: string;

  @ApiProperty({
    example: 'elena.rostova@example.com',
    description: 'Customer contact email for receipt and tracking',
  })
  @IsEmail({}, { message: 'Must be a valid email address' })
  customerEmail: string;

  @ApiProperty({
    example: '+919876543210',
    description: 'Operational contact phone number',
  })
  @IsString()
  @MinLength(5, { message: 'Phone number must be at least 5 digits' })
  @MaxLength(30, { message: 'Phone number must not exceed 30 digits' })
  customerPhone: string;

  @ApiPropertyOptional({
    example: 'Penthouse 4B, Aurel Tower, Marine Drive',
    description: 'Delivery address (required for DELIVERY channel)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Delivery address must not exceed 500 characters' })
  deliveryAddress?: string;

  @ApiPropertyOptional({
    example: 'Table 7',
    description: 'Table number (required for DINE_IN channel)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Table number must not exceed 20 characters' })
  tableNumber?: string;

  @ApiPropertyOptional({
    example: 'Please prepare the steak medium rare with extra flaky sea salt.',
    description: 'Special culinary or hospitality instructions for kitchen',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Special instructions must not exceed 500 characters' })
  specialInstructions?: string;

  @ApiProperty({
    type: [CreateOrderItemDto],
    description: 'List of dishes and items in the order',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Order must contain at least one item' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ApiProperty({
    example: PaymentMode.DEMO,
    enum: PaymentMode,
    description: 'Payment settlement mode (DEMO or CASH for MVP)',
  })
  @IsEnum(PaymentMode, { message: 'Invalid payment mode. Supported: CASH, DEMO' })
  paymentMode: PaymentMode;
}
