import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn } from 'class-validator';
import { UserRole, UpdateStaffRoleRequest } from '@aurel/shared-types';

export class UpdateStaffRoleDto implements UpdateStaffRoleRequest {
  @ApiProperty({
    example: 'MANAGER',
    enum: [UserRole.STAFF, UserRole.KITCHEN, UserRole.MANAGER, UserRole.ADMIN],
    description: 'Updated authorization role for the staff member',
  })
  @IsEnum(UserRole, { message: 'Role must be a valid UserRole' })
  @IsIn([UserRole.STAFF, UserRole.KITCHEN, UserRole.MANAGER, UserRole.ADMIN], {
    message: 'Staff role must be STAFF, KITCHEN, MANAGER, or ADMIN',
  })
  role: UserRole;
}
