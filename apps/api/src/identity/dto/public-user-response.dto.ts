import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PublicUserResponse } from '@aurel/shared-types';
import { User } from '@prisma/client';

export class PublicUserResponseDto implements PublicUserResponse {
  @ApiProperty({
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Stable unique identifier for the user account (UUIDv4)',
  })
  id: string;

  @ApiProperty({
    example: 'customer@example.com',
    description: 'Canonical customer email address',
  })
  email: string;

  @ApiProperty({
    example: 'Example Customer',
    description: 'Customer full display name',
  })
  fullName: string;

  @ApiPropertyOptional({
    example: '+919876543210',
    description: 'Customer contact phone number if provided',
    nullable: true,
  })
  phone?: string | null;

  @ApiProperty({
    example: true,
    description: 'Account activation status',
  })
  isActive: boolean;

  @ApiProperty({
    example: '2026-10-11T18:00:00.000Z',
    description: 'Account creation timestamp in ISO 8601 format',
  })
  createdAt: string;

  /**
   * Sanitizing factory: extracts only safe public fields from the database User entity.
   * Completely excludes passwordHash, role, and internal fields.
   */
  static fromEntity(user: User): PublicUserResponseDto {
    const dto = new PublicUserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.fullName = user.fullName;
    dto.phone = user.phone;
    dto.isActive = user.isActive;
    dto.createdAt =
      user.createdAt instanceof Date
        ? user.createdAt.toISOString()
        : (user.createdAt as unknown as string);
    return dto;
  }
}
