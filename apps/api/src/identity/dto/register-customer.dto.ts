import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { RegisterCustomerRequest } from '@aurel/shared-types';

export class RegisterCustomerDto implements RegisterCustomerRequest {
  @ApiProperty({
    example: 'customer@example.com',
    description: 'Canonical customer email address (unique, normalized to lowercase and trimmed)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsNotEmpty({ message: 'email is required' })
  @MaxLength(255, { message: 'email cannot exceed 255 characters' })
  email: string;

  @ApiProperty({
    example: 'ExampleSecurePassphrase#42',
    description: 'Customer password (minimum 8 characters, maximum 128 characters)',
  })
  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password is required' })
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @MaxLength(128, { message: 'password cannot exceed 128 characters' })
  password: string;

  @ApiProperty({
    example: 'Example Customer',
    description: 'Customer full display name',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'fullName must be a string' })
  @IsNotEmpty({ message: 'fullName is required' })
  @MaxLength(100, { message: 'fullName cannot exceed 100 characters' })
  fullName: string;

  @ApiPropertyOptional({
    example: '+919876543210',
    description: 'Optional contact phone number in international E.164 format',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'phone must be a string' })
  @Matches(/^\+?[1-9]\d{7,14}$/, {
    message: 'phone must be a valid international phone number (e.g. +919876543210)',
  })
  @MaxLength(20, { message: 'phone cannot exceed 20 characters' })
  phone?: string;
}
