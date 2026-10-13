import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength, IsOptional, IsEnum, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole, CreateStaffRequest } from '@aurel/shared-types';

export class CreateStaffDto implements CreateStaffRequest {
  @ApiProperty({
    example: 'chef.ramsay@aurel.restaurant',
    description: 'Unique email address for staff identity',
  })
  @IsEmail({}, { message: 'Must be a valid email address format' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiProperty({
    example: 'SecureStaffPassword2026!',
    description: 'Initial password for staff member (minimum 8 characters)',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(100, { message: 'Password must not exceed 100 characters' })
  password: string;

  @ApiProperty({
    example: 'Gordon Ramsay',
    description: 'Full legal or display name of the staff member',
  })
  @IsString()
  @MinLength(2, { message: 'Full name must be at least 2 characters' })
  @MaxLength(100, { message: 'Full name must not exceed 100 characters' })
  fullName: string;

  @ApiPropertyOptional({
    example: '+14155550199',
    description: 'Optional operational contact phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Phone number must not exceed 20 characters' })
  phone?: string;

  @ApiProperty({
    example: 'KITCHEN',
    enum: [UserRole.STAFF, UserRole.KITCHEN, UserRole.MANAGER, UserRole.ADMIN],
    description: 'Assigned staff authorization role',
  })
  @IsEnum(UserRole, { message: 'Role must be a valid UserRole' })
  @IsIn([UserRole.STAFF, UserRole.KITCHEN, UserRole.MANAGER, UserRole.ADMIN], {
    message: 'Staff provisioning role must be STAFF, KITCHEN, MANAGER, or ADMIN',
  })
  role: UserRole;
}
