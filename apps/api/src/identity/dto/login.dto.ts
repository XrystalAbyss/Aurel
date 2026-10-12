import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { LoginRequest } from '@aurel/shared-types';

export class LoginDto implements LoginRequest {
  @ApiProperty({
    example: 'customer@example.com',
    description: 'Registered customer or user email address (case-insensitive and trimmed)',
    maxLength: 255,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'A valid email address is required.' })
  @MaxLength(255, { message: 'Email address cannot exceed 255 characters.' })
  @IsNotEmpty({ message: 'Email address is required.' })
  email!: string;

  @ApiProperty({
    example: 'ExampleSecurePassphrase#42',
    description: 'Account password passphrase',
    minLength: 1,
    maxLength: 128,
  })
  @IsString({ message: 'Password must be a string.' })
  @MinLength(1, { message: 'Password is required.' })
  @MaxLength(128, { message: 'Password cannot exceed 128 characters.' })
  @IsNotEmpty({ message: 'Password is required.' })
  password!: string;
}
