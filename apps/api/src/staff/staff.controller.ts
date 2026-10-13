import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { User } from '@prisma/client';
import { Permission, PaginatedResponse } from '@aurel/shared-types';
import { StaffService } from './staff.service';
import { RateLimiterService } from '../identity/rate-limiter.service';
import { SessionAuthGuard } from '../identity/guards/session-auth.guard';
import { CsrfGuard } from '../identity/guards/csrf.guard';
import { PermissionsGuard } from '../identity/guards/permissions.guard';
import { RequirePermissions } from '../identity/decorators/permissions.decorator';
import { CurrentUser } from '../identity/decorators/current-user.decorator';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffRoleDto } from './dto/update-staff-role.dto';
import { UpdateStaffStatusDto } from './dto/update-staff-status.dto';
import { QueryStaffDto } from './dto/query-staff.dto';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { StaffUserResponseDto } from './dto/staff-user-response.dto';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';

@ApiTags('Staff Administration')
@Controller('management')
export class StaffController {
  constructor(
    private readonly staffService: StaffService,
    private readonly rateLimiterService: RateLimiterService,
  ) {}

  @Post('staff')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionAuthGuard, CsrfGuard, PermissionsGuard)
  @RequirePermissions(Permission.STAFF_CREATE)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Provision a new staff account',
    description:
      'Creates a new staff, kitchen, or manager account. Managers may provision STAFF and KITCHEN only.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Staff account provisioned successfully',
    type: StaffUserResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid input or malformed payload' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions or cross-role provisioning violation',
  })
  @ApiConflictResponse({ description: 'Email address already exists' })
  async createStaff(
    @CurrentUser() actor: User,
    @Body() dto: CreateStaffDto,
    @Req() req: Request,
  ): Promise<StaffUserResponseDto> {
    const clientIp = this.rateLimiterService.extractClientIp(req);
    const requestId = req.headers['x-request-id'] as string | undefined;
    return this.staffService.createStaff(actor, dto, clientIp, requestId);
  }

  @Get('staff')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STAFF_READ)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'List restaurant staff directory',
    description:
      'Returns a paginated list of staff accounts. Results are scoped according to caller role.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated staff directory',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async getStaffList(
    @CurrentUser() actor: User,
    @Query() query: QueryStaffDto,
  ): Promise<PaginatedResponse<StaffUserResponseDto>> {
    return this.staffService.getStaffList(actor, query);
  }

  @Get('staff/:id')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STAFF_SELF_READ)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Inspect a specific staff account',
    description:
      'Retrieves public profile details for a staff member. Managers cannot inspect manager or admin accounts. Employees may inspect their own profile.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Staff account details',
    type: StaffUserResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Forbidden access to higher-privilege account' })
  @ApiNotFoundResponse({ description: 'Staff user not found' })
  async getStaffById(
    @CurrentUser() actor: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<StaffUserResponseDto> {
    return this.staffService.getStaffById(actor, id);
  }

  @Patch('staff/:id/role')
  @UseGuards(SessionAuthGuard, CsrfGuard, PermissionsGuard)
  @RequirePermissions(Permission.STAFF_ROLE_ASSIGN)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Modify a staff account role',
    description:
      'Updates the target role and atomically revokes all existing sessions in PostgreSQL.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Role updated and active sessions revoked',
    type: StaffUserResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({
    description: 'Self-mutation, privilege escalation, or last admin violation',
  })
  @ApiNotFoundResponse({ description: 'Staff user not found' })
  async updateStaffRole(
    @CurrentUser() actor: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateStaffRoleDto,
    @Req() req: Request,
  ): Promise<StaffUserResponseDto> {
    const clientIp = this.rateLimiterService.extractClientIp(req);
    const requestId = req.headers['x-request-id'] as string | undefined;
    return this.staffService.updateStaffRole(actor, id, dto, clientIp, requestId);
  }

  @Patch('staff/:id/status')
  @UseGuards(SessionAuthGuard, CsrfGuard, PermissionsGuard)
  @RequirePermissions(Permission.STAFF_DEACTIVATE)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Activate or deactivate a staff account',
    description:
      'Toggles active status. Deactivation immediately revokes all active sessions in PostgreSQL.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Account status updated',
    type: StaffUserResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({
    description: 'Self-deactivation, cross-role violation, or last admin violation',
  })
  @ApiNotFoundResponse({ description: 'Staff user not found' })
  async updateStaffStatus(
    @CurrentUser() actor: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateStaffStatusDto,
    @Req() req: Request,
  ): Promise<StaffUserResponseDto> {
    const clientIp = this.rateLimiterService.extractClientIp(req);
    const requestId = req.headers['x-request-id'] as string | undefined;
    return this.staffService.updateStaffStatus(actor, id, dto, clientIp, requestId);
  }

  @Get('audit-logs')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.AUDIT_READ)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Query security audit trail',
    description:
      'Returns paginated audit records for privileged account actions. Restricted exclusively to administrators.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated security audit records',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Requires audit.read entitlement' })
  async getAuditLogs(
    @Query() query: QueryAuditLogsDto,
  ): Promise<PaginatedResponse<AuditLogResponseDto>> {
    return this.staffService.getAuditLogs(query);
  }
}
