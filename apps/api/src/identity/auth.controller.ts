import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { User } from '@prisma/client';
import { UserRole } from '@aurel/shared-types';
import { IdentityService } from './identity.service';
import { SessionService } from './session.service';
import { CsrfService } from './csrf.service';
import { RateLimiterService } from './rate-limiter.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { LoginDto } from './dto/login.dto';
import { SetupPasswordDto } from './dto/setup-password.dto';
import { PublicUserResponseDto } from './dto/public-user-response.dto';
import { StaffUserResponseDto } from '../staff/dto/staff-user-response.dto';
import { LogoutResponseDto, CsrfTokenResponseDto } from './dto/auth-responses.dto';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { ConfigService } from '@nestjs/config';
import {
  getSessionCookieName,
  getSessionCookieOptions,
  getCsrfCookieName,
  getCsrfCookieOptions,
  getClearSessionCookieOptions,
  getClearCsrfCookieOptions,
} from './cookie.config';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly identityService: IdentityService,
    private readonly sessionService: SessionService,
    private readonly csrfService: CsrfService,
    private readonly rateLimiterService: RateLimiterService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Register a new customer account',
    description:
      'Creates a new customer identity record with Argon2id password hash. Does NOT establish a session.',
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
  async register(
    @Body() registerDto: RegisterCustomerDto,
    @Req() req: Request,
  ): Promise<PublicUserResponseDto> {
    const clientIp = this.rateLimiterService.extractClientIp(req);
    return this.identityService.registerCustomer(registerDto, clientIp);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Authenticate credentials and establish a secure session',
    description:
      'Authenticates email and password, creates a persistent server-side session, and sets secure HttpOnly session and CSRF cookies.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Authentication successful; session established',
    type: PublicUserResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Input validation failure or malformed payload',
  })
  @ApiUnauthorizedResponse({
    description:
      'Generic authentication failure (invalid email, wrong password, or inactive account)',
  })
  @ApiForbiddenResponse({
    description: 'Cross-site origin policy violation',
  })
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUserResponseDto> {
    const clientIp = this.rateLimiterService.extractClientIp(req);
    const userAgent = req.headers['user-agent'] as string | undefined;

    const { user, session, rawToken } = await this.identityService.authenticateCustomer(
      loginDto,
      clientIp,
      userAgent,
    );

    // Set secure HttpOnly session cookie
    const sessionCookieName = getSessionCookieName(this.configService);
    const sessionCookieOpts = getSessionCookieOptions(this.configService);
    res.cookie(sessionCookieName, rawToken, sessionCookieOpts);

    // Issue session-bound CSRF token and set readable CSRF cookie
    const csrfToken = this.csrfService.generateToken(session.id);
    const csrfCookieName = getCsrfCookieName(this.configService);
    const csrfCookieOpts = getCsrfCookieOptions(this.configService);
    res.cookie(csrfCookieName, csrfToken, csrfCookieOpts);
    res.setHeader('X-CSRF-Token', csrfToken);

    return PublicUserResponseDto.fromEntity(user);
  }

  @Post('operations-login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Authenticate restaurant employee credentials for Operations workspace',
    description:
      'Authenticates staff credentials and establishes a session. Customers are strictly rejected with HTTP 403 before any session is created.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Operations authentication successful',
    type: StaffUserResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failure' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials or inactive account' })
  @ApiForbiddenResponse({
    description: 'Customer accounts not permitted in operations workspace',
  })
  async operationsLogin(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StaffUserResponseDto> {
    const clientIp = this.rateLimiterService.extractClientIp(req);
    const userAgent = req.headers['user-agent'] as string | undefined;

    // Gate F: Strictly enforce allowed roles prior to session issuance
    const { user, session, rawToken } = await this.identityService.authenticateCustomer(
      loginDto,
      clientIp,
      userAgent,
      [UserRole.STAFF, UserRole.KITCHEN, UserRole.MANAGER, UserRole.ADMIN],
    );

    // Set secure HttpOnly session cookie
    const sessionCookieName = getSessionCookieName(this.configService);
    const sessionCookieOpts = getSessionCookieOptions(this.configService);
    res.cookie(sessionCookieName, rawToken, sessionCookieOpts);

    // Issue session-bound CSRF token and set readable CSRF cookie
    const csrfToken = this.csrfService.generateToken(session.id);
    const csrfCookieName = getCsrfCookieName(this.configService);
    const csrfCookieOpts = getCsrfCookieOptions(this.configService);
    res.cookie(csrfCookieName, csrfToken, csrfCookieOpts);
    res.setHeader('X-CSRF-Token', csrfToken);

    return StaffUserResponseDto.fromEntity(user);
  }

  @Post('setup-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Establish permanent password for newly provisioned staff account',
    description: 'Consumes single-use expiring setup token and sets initial employee password.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Password established successfully',
  })
  @ApiBadRequestResponse({ description: 'Invalid input or malformed payload' })
  @ApiUnauthorizedResponse({ description: 'Invalid, expired, or replayed setup token' })
  async setupPassword(
    @Body() dto: SetupPasswordDto,
    @Req() req: Request,
  ): Promise<{ success: boolean; message: string }> {
    const clientIp = this.rateLimiterService.extractClientIp(req);
    return this.identityService.setupPassword(dto, clientIp);
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Get current authenticated user profile',
    description: 'Validates active server-side session cookie and returns public user profile.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Current authenticated user profile',
    type: PublicUserResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, revoked, or invalid session',
  })
  async me(@CurrentUser() user: User): Promise<PublicUserResponseDto | StaffUserResponseDto> {
    if (user.role !== UserRole.CUSTOMER) {
      return StaffUserResponseDto.fromEntity(user);
    }
    return PublicUserResponseDto.fromEntity(user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Terminate the current session',
    description: 'Revokes the active session in PostgreSQL and clears authentication cookies.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Session revoked successfully',
    type: LogoutResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid session',
  })
  @ApiForbiddenResponse({
    description: 'Missing or invalid anti-CSRF token',
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponseDto> {
    const rawToken = (req as unknown as { rawSessionToken?: string }).rawSessionToken;
    if (rawToken) {
      await this.sessionService.revokeSession(rawToken);
    }

    const sessionCookieName = getSessionCookieName(this.configService);
    const csrfCookieName = getCsrfCookieName(this.configService);
    res.clearCookie(sessionCookieName, getClearSessionCookieOptions(this.configService));
    res.clearCookie(csrfCookieName, getClearCsrfCookieOptions(this.configService));

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Terminate all active sessions for the current user',
    description:
      'Revokes all active sessions for this account across all devices and clears cookies.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'All active sessions revoked successfully',
    type: LogoutResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid session',
  })
  @ApiForbiddenResponse({
    description: 'Missing or invalid anti-CSRF token',
  })
  async logoutAll(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponseDto> {
    const count = await this.sessionService.revokeAllUserSessions(user.id);

    const sessionCookieName = getSessionCookieName(this.configService);
    const csrfCookieName = getCsrfCookieName(this.configService);
    res.clearCookie(sessionCookieName, getClearSessionCookieOptions(this.configService));
    res.clearCookie(csrfCookieName, getClearCsrfCookieOptions(this.configService));

    return {
      success: true,
      message: `All active sessions revoked successfully (${count} terminated)`,
    };
  }

  @Get('csrf')
  @ApiOperation({
    summary: 'Obtain an anti-CSRF token',
    description:
      'Provides a double-submit anti-CSRF token and sets the aurel_csrf cookie for single-page applications.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'CSRF token issued successfully',
    type: CsrfTokenResponseDto,
  })
  async getCsrf(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CsrfTokenResponseDto> {
    const cookieName = getSessionCookieName(this.configService);
    const token = req.cookies?.[cookieName];

    let csrfToken: string;
    if (token) {
      const validated = await this.sessionService.validateSession(token);
      if (validated) {
        csrfToken = this.csrfService.generateToken(validated.session.id);
      } else {
        csrfToken = this.csrfService.generateAnonymousToken();
      }
    } else {
      csrfToken = this.csrfService.generateAnonymousToken();
    }

    const csrfCookieName = getCsrfCookieName(this.configService);
    const csrfCookieOpts = getCsrfCookieOptions(this.configService);
    res.cookie(csrfCookieName, csrfToken, csrfCookieOpts);
    res.setHeader('X-CSRF-Token', csrfToken);

    return { csrfToken };
  }
}
