import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiConflictResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Permission, PaginatedResponse } from '@aurel/shared-types';
import { User } from '@prisma/client';
import { SessionAuthGuard } from '../identity/guards/session-auth.guard';
import { CsrfGuard } from '../identity/guards/csrf.guard';
import { PermissionsGuard } from '../identity/guards/permissions.guard';
import { RequirePermissions } from '../identity/decorators/permissions.decorator';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { RateLimiterService } from '../identity/rate-limiter.service';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { QueryStaffDto } from './dto/query-staff.dto';
import { StaffUserResponseDto } from './dto/staff-user-response.dto';

@ApiTags('Admin User Management')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly staffService: StaffService,
    private readonly rateLimiterService: RateLimiterService,
  ) {}

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionAuthGuard, CsrfGuard, PermissionsGuard)
  @RequirePermissions(Permission.ADMIN_CREATE)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Provision a new administrator or manager account',
    description: 'Restricted administrative endpoint for provisioning administrator identities.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Administrator provisioned successfully',
    type: StaffUserResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid input or malformed payload' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Requires admin.create entitlement' })
  @ApiConflictResponse({ description: 'Email address already exists' })
  async createAdminUser(
    @CurrentUser() actor: User,
    @Body() dto: CreateStaffDto,
    @Req() req: Request,
  ): Promise<StaffUserResponseDto> {
    const clientIp = this.rateLimiterService.extractClientIp(req);
    const requestId = req.headers['x-request-id'] as string | undefined;
    return this.staffService.createStaff(actor, dto, clientIp, requestId);
  }

  @Get('users')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ADMIN_CREATE)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'List users (administrative directory)',
    description: 'Returns a paginated list of accounts for administrators.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Directory list returned successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async listUsers(
    @CurrentUser() actor: User,
    @Query() query: QueryStaffDto,
  ): Promise<PaginatedResponse<StaffUserResponseDto>> {
    return this.staffService.getStaffList(actor, query);
  }

  @Get('users/:id')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ADMIN_CREATE)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Get user details by ID',
    description: 'Returns account details for the specified user.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User details returned successfully',
    type: StaffUserResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async getUserById(
    @CurrentUser() actor: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<StaffUserResponseDto> {
    return this.staffService.getStaffById(actor, id);
  }
}
