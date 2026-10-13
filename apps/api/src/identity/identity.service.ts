import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma, User, AuthSession, AuditAction, UserRole } from '@prisma/client';
import { ErrorCode } from '@aurel/shared-types';
import * as crypto from 'crypto';
import { PasswordService } from './password.service';
import { UsersRepository } from './users.repository';
import { SessionService } from './session.service';
import { RateLimiterService } from './rate-limiter.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { PublicUserResponseDto } from './dto/public-user-response.dto';
import { LoginDto } from './dto/login.dto';
import { SetupPasswordDto } from './dto/setup-password.dto';

export interface AuthenticationResult {
  user: User;
  session: AuthSession;
  rawToken: string;
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly rateLimiterService: RateLimiterService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Canonicalizes email address according to the platform identity policy:
   * 1. Trim surrounding whitespace.
   * 2. Convert all characters to lowercase.
   * Local-part structure is preserved to prevent destructive collisions.
   */
  canonicalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Registers a new customer account.
   *
   * 1. Enforces IP and target-email abuse rate limiting.
   * 2. Normalizes the email address.
   * 3. Hashes password using Argon2id with concurrency throttling.
   * 4. Creates the user record in PostgreSQL.
   * 5. Intercepts database unique constraint violations (P2002) and returns HTTP 409 Conflict.
   * 6. Returns a sanitized public account response.
   * NOTE: Registration does NOT issue an authenticated session.
   */
  async registerCustomer(
    dto: RegisterCustomerDto,
    clientIp?: string,
  ): Promise<PublicUserResponseDto> {
    const canonicalEmail = this.canonicalizeEmail(dto.email);

    // Abuse defense: per-IP and per-email rate limiting
    if (clientIp) {
      this.rateLimiterService.consume(
        this.rateLimiterService.getPolicy('REGISTRATION_IP'),
        clientIp,
      );
    }
    const emailKey = this.rateLimiterService.hashIdentifier(canonicalEmail);
    this.rateLimiterService.consume(
      this.rateLimiterService.getPolicy('REGISTRATION_EMAIL'),
      emailKey,
    );

    // Fast-fail availability pre-check (database unique index remains authoritative)
    const existingUser = await this.usersRepository.findByEmail(canonicalEmail);
    if (existingUser) {
      this.logger.warn('Registration rejected: canonical email already exists');
      throw new ConflictException({
        message: 'An account with this email address already exists.',
        code: ErrorCode.CONFLICT,
        error: 'Conflict',
      });
    }

    // CPU/Memory protection: throttle concurrent Argon2id hashing operations
    const releaseSlot = await this.rateLimiterService.acquireHashSlot();
    let passwordHash: string;
    try {
      passwordHash = await this.passwordService.hash(dto.password);
    } finally {
      releaseSlot();
    }

    try {
      const user = await this.usersRepository.createUser({
        email: canonicalEmail,
        passwordHash,
        fullName: dto.fullName.trim(),
        phone: dto.phone?.trim() ?? null,
      });

      this.logger.log(`Customer registration completed successfully for user ID: ${user.id}`);
      return PublicUserResponseDto.fromEntity(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          // Concurrent registration race where another transaction committed first
          this.logger.warn('Database uniqueness violation caught during customer registration');
          throw new ConflictException({
            message: 'An account with this email address already exists.',
            code: ErrorCode.CONFLICT,
            error: 'Conflict',
          });
        }
      }

      this.logger.error('Unexpected database failure during user registration: internal error');
      throw new InternalServerErrorException({
        message: 'Unable to process registration at this time.',
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  }

  /**
   * Authenticates user credentials and establishes a database-backed session:
   * 1. Evaluates client IP and per-account failed-attempt rate limits.
   * 2. Canonicalizes email.
   * 3. Safely queries user record.
   * 4. Verifies password using Argon2id with concurrency gating.
   *    - Uses dummy-hash verification for nonexistent accounts to eliminate timing side channels.
   * 5. Checks account active status (isActive === true).
   * 6. Validates account provisioning state (isPendingSetup === false).
   * 7. Enforces endpoint role scoping prior to session generation.
   * 8. Generates opaque 256-bit token and persists HMAC digest in PostgreSQL.
   * 9. Resets failed login rate-limit counter on success.
   * 10. Returns sanitized user, session, and raw bearer token.
   */
  async authenticateCustomer(
    dto: LoginDto,
    clientIp: string,
    userAgent?: string | null,
    allowedRoles?: UserRole[],
  ): Promise<AuthenticationResult> {
    // Abuse defense: IP rate limit
    this.rateLimiterService.consume(this.rateLimiterService.getPolicy('LOGIN_IP'), clientIp);

    const canonicalEmail = this.canonicalizeEmail(dto.email);
    const emailKey = this.rateLimiterService.hashIdentifier(canonicalEmail);

    // Abuse defense: target-account failed attempt rate limit
    this.rateLimiterService.consume(this.rateLimiterService.getPolicy('LOGIN_ACCOUNT'), emailKey);

    const user = await this.usersRepository.findByEmail(canonicalEmail);

    // Concurrency gated password verification
    const releaseSlot = await this.rateLimiterService.acquireHashSlot();
    let isPasswordValid = false;
    try {
      if (!user) {
        // Timing mitigation: execute identical Argon2id work when identity does not exist
        await this.passwordService.verifyDummy(dto.password);
      } else {
        isPasswordValid = await this.passwordService.verify(user.passwordHash, dto.password);
      }
    } finally {
      releaseSlot();
    }

    // Generic failure response: do not disclose existence, password mismatch, or active state
    if (!user || !isPasswordValid || !user.isActive) {
      this.logger.warn('Authentication rejected: invalid credentials or inactive account');
      throw new UnauthorizedException({
        message: 'Invalid email or password.',
        code: ErrorCode.UNAUTHORIZED,
        error: 'Unauthorized',
      });
    }

    // Gate D: Unprovisioned or pending identities cannot authenticate
    if (user.isPendingSetup) {
      this.logger.warn('Authentication rejected: staff account pending credential setup');
      throw new UnauthorizedException({
        message: 'Account setup pending: initial credential must be established prior to login.',
        code: ErrorCode.UNAUTHORIZED,
        error: 'Unauthorized',
      });
    }

    // Gate F: Reject unauthorized roles before issuing any session
    if (allowedRoles && !allowedRoles.includes(user.role as UserRole)) {
      this.logger.warn(`Authentication rejected: role ${user.role} not permitted on endpoint`);
      throw new ForbiddenException({
        message: 'Customer accounts are not authorized to access the operations workspace.',
        code: ErrorCode.FORBIDDEN,
        error: 'Forbidden',
      });
    }

    // Successful authentication: reset failed-attempt counter for this account
    this.rateLimiterService.reset(this.rateLimiterService.getPolicy('LOGIN_ACCOUNT'), emailKey);

    // Persist session before issuing cookie
    const { session, rawToken } = await this.sessionService.createSession(user.id, userAgent);

    return { user, session, rawToken };
  }

  /**
   * Completes initial staff credential provisioning using a single-use setup token:
   * 1. Hashes incoming token to find matching pending staff user.
   * 2. Verifies token is not expired and account is in pending setup state.
   * 3. Hashes new password with Argon2id.
   * 4. Updates password, clears setup token, marks isPendingSetup = false.
   * 5. Atomically inserts audit log record.
   */
  async setupPassword(
    dto: SetupPasswordDto,
    clientIp?: string,
  ): Promise<{ success: boolean; message: string }> {
    // Abuse defense: IP rate limit
    this.rateLimiterService.consume(
      this.rateLimiterService.getPolicy('SETUP_IP'),
      clientIp || '127.0.0.1',
    );

    const rawToken = dto.token.trim();
    const tokenDigest = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenKey = this.rateLimiterService.hashIdentifier(tokenDigest);

    // Abuse defense: token attempt rate limit
    this.rateLimiterService.consume(this.rateLimiterService.getPolicy('SETUP_TOKEN'), tokenKey);

    const user = await this.prisma.user.findFirst({
      where: {
        setupTokenDigest: tokenDigest,
        isPendingSetup: true,
      },
    });

    const now = new Date();
    if (!user || !user.setupTokenExpiresAt || user.setupTokenExpiresAt < now) {
      // Timing attack mitigation: perform identical dummy hashing work
      const releaseSlot = await this.rateLimiterService.acquireHashSlot();
      try {
        await this.passwordService.verifyDummy(dto.newPassword);
      } finally {
        releaseSlot();
      }

      this.logger.warn('Password setup rejected: invalid or expired setup token');
      throw new UnauthorizedException({
        message: 'Invalid or expired account setup token.',
        code: ErrorCode.UNAUTHORIZED,
        error: 'Unauthorized',
      });
    }

    // Hash new password using Argon2id with concurrency slot gating
    const releaseSlot = await this.rateLimiterService.acquireHashSlot();
    let newHash: string;
    try {
      newHash = await this.passwordService.hash(dto.newPassword);
    } finally {
      releaseSlot();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          isPendingSetup: false,
          setupTokenDigest: null,
          setupTokenExpiresAt: null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          targetId: user.id,
          action: AuditAction.STAFF_PASSWORD_ESTABLISHED,
          clientIp: clientIp || null,
          metadata: {
            email: user.email,
            role: user.role,
          },
        },
      });
    });

    this.rateLimiterService.reset(this.rateLimiterService.getPolicy('SETUP_TOKEN'), tokenKey);

    this.logger.log(`Password successfully established for staff user ID: ${user.id}`);
    return {
      success: true,
      message: 'Password established successfully. You may now log in to the operations workspace.',
    };
  }
}
