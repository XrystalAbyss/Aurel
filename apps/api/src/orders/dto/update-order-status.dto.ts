import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderStatus, UpdateOrderStatusRequest } from '@aurel/shared-types';

export class UpdateOrderStatusDto implements UpdateOrderStatusRequest {
  @ApiProperty({
    example: OrderStatus.PREPARING,
    enum: OrderStatus,
    description: 'Target order status in fulfillment lifecycle',
  })
  @IsEnum(OrderStatus, { message: 'Must be a valid OrderStatus' })
  status: OrderStatus;

  @ApiPropertyOptional({
    example: 'Started binchotan sear on steak at 18:42 IST',
    description: 'Internal operations or kitchen note',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'Notes must not exceed 300 characters' })
  notes?: string;
}
