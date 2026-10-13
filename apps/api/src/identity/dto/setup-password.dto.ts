import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';
import { SetupPasswordRequest } from '@aurel/shared-types';

export class SetupPasswordDto implements SetupPasswordRequest {
  @ApiProperty({
    example: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
    description: 'Single-use cryptographic setup token issued during staff account creation',
  })
  @IsString({ message: 'Setup token must be a string' })
  @MinLength(16, { message: 'Setup token must be at least 16 characters' })
  @MaxLength(128, { message: 'Setup token must not exceed 128 characters' })
  token: string;

  @ApiProperty({
    example: 'MyNewPermanentPassword2026!',
    description: 'New permanent password chosen by the employee (minimum 8 characters)',
  })
  @IsString({ message: 'New password must be a string' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(100, { message: 'Password must not exceed 100 characters' })
  newPassword: string;
}
