import { ApiProperty } from '@nestjs/swagger';
import { StaffUserResponse, UserRole } from '@aurel/shared-types';
import { User } from '@prisma/client';
import { PublicUserResponseDto } from '../../identity/dto/public-user-response.dto';

export class StaffUserResponseDto extends PublicUserResponseDto implements StaffUserResponse {
  @ApiProperty({
    example: 'KITCHEN',
    enum: [UserRole.STAFF, UserRole.KITCHEN, UserRole.MANAGER, UserRole.ADMIN],
    description: 'Assigned staff authorization role',
  })
  role: UserRole;

  /**
   * Factory for staff directory serialization: includes assigned role while excluding password hashes and digests.
   */
  static fromEntity(user: User): StaffUserResponseDto {
    const dto = new StaffUserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.fullName = user.fullName;
    dto.phone = user.phone;
    dto.isActive = user.isActive;
    dto.role = user.role as UserRole;
    dto.createdAt =
      user.createdAt instanceof Date
        ? user.createdAt.toISOString()
        : (user.createdAt as unknown as string);
    return dto;
  }
}
