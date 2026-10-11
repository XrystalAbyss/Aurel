import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { IdentityService } from './identity.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { PublicUserResponseDto } from './dto/public-user-response.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly identityService: IdentityService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new customer account',
    description:
      'Creates a new customer identity record with Argon2id password hash. IMPORTANT: Registration does NOT establish an authenticated session.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Customer account registered successfully',
    type: PublicUserResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Input validation failure, missing required field, or disallowed attribute',
  })
  @ApiConflictResponse({
    description: 'Account with given email address already exists',
  })
  @ApiInternalServerErrorResponse({
    description: 'Sanitized internal server error',
  })
  async register(@Body() registerDto: RegisterCustomerDto): Promise<PublicUserResponseDto> {
    return this.identityService.registerCustomer(registerDto);
  }
}
