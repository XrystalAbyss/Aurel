import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus, FulfillmentChannel } from '@aurel/shared-types';

export class QueryOrdersDto {
  @ApiPropertyOptional({
    enum: OrderStatus,
    description: 'Filter orders by status',
  })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({
    enum: FulfillmentChannel,
    description: 'Filter orders by fulfillment channel',
  })
  @IsOptional()
  @IsEnum(FulfillmentChannel)
  fulfillmentChannel?: FulfillmentChannel;

  @ApiPropertyOptional({
    example: 1,
    default: 1,
    description: 'Page number',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 50,
    default: 50,
    description: 'Number of orders per page',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
