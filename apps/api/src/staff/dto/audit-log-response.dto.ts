import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction, AuditLogEntry } from '@aurel/shared-types';
import { AuditLog } from '@prisma/client';

export class AuditLogResponseDto implements AuditLogEntry {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Unique identifier for the audit log entry (UUIDv4)',
  })
  id: string;

  @ApiPropertyOptional({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'ID of the actor who performed the privileged action (null if system)',
    nullable: true,
  })
  actorId?: string | null;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'ID of the target entity/user affected by the action (null if target was purged)',
    nullable: true,
  })
  targetId?: string | null;

  @ApiProperty({
    example: 'STAFF_USER_CREATED',
    enum: AuditAction,
    description: 'Security audit action identifier',
  })
  action: AuditAction;

  @ApiPropertyOptional({
    example: 'req_123456789',
    description: 'HTTP request ID associated with the mutation',
    nullable: true,
  })
  requestId?: string | null;

  @ApiPropertyOptional({
    example: '192.168.1.1',
    description: 'Sanitized client IP address of the caller',
    nullable: true,
  })
  clientIp?: string | null;

  @ApiPropertyOptional({
    example: { role: 'KITCHEN' },
    description: 'Sanitized mutation metadata (old/new state attributes)',
    nullable: true,
  })
  metadata?: Record<string, unknown> | null;

  @ApiProperty({
    example: '2026-10-13T12:00:00.000Z',
    description: 'Timestamp when the audit event was committed in ISO 8601 format',
  })
  createdAt: string;

  static fromEntity(entity: AuditLog): AuditLogResponseDto {
    const dto = new AuditLogResponseDto();
    dto.id = entity.id;
    dto.actorId = entity.actorId;
    dto.targetId = entity.targetId;
    dto.action = entity.action as AuditAction;
    dto.requestId = entity.requestId;
    dto.clientIp = entity.clientIp;
    dto.metadata = entity.metadata as Record<string, unknown> | null;
    dto.createdAt =
      entity.createdAt instanceof Date
        ? entity.createdAt.toISOString()
        : (entity.createdAt as unknown as string);
    return dto;
  }
}
