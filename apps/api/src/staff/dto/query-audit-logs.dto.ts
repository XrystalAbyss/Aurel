import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsEnum, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction } from '@aurel/shared-types';

export class QueryAuditLogsDto {
  @ApiPropertyOptional({
    example: 1,
    default: 1,
    description: 'Page number (1-indexed)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be an integer' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    default: 20,
    description: 'Items per page (maximum 100)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit must be an integer' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(100, { message: 'Limit cannot exceed 100' })
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: AuditAction,
    description: 'Filter audit records by specific security action identifier',
  })
  @IsOptional()
  @IsEnum(AuditAction, { message: 'Action must be a valid AuditAction' })
  action?: AuditAction;

  @ApiPropertyOptional({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Filter audit records by target user ID (UUIDv4)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Target ID must be a valid UUIDv4' })
  targetId?: string;
}
