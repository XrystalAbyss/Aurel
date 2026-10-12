import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma, User, AuthSession } from '@prisma/client';
import { ErrorCode } from '@aurel/shared-types';
import { PasswordService } from './password.service';
import { UsersRepository } from './users.repository';
import { SessionService } from './session.service';
import { RateLimiterService } from './rate-limiter.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { PublicUserResponseDto } from './dto/public-user-response.dto';
import { LoginDto } from './dto/login.dto';

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
   * 6. Generates opaque 256-bit token and persists HMAC digest in PostgreSQL.
   * 7. Resets failed login rate-limit counter on success.
   * 8. Returns sanitized user, session, and raw bearer token.
   */
  async authenticateCustomer(
    dto: LoginDto,
    clientIp: string,
    userAgent?: string | null,
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

    // Successful authentication: reset failed-attempt counter for this account
    this.rateLimiterService.reset(this.rateLimiterService.getPolicy('LOGIN_ACCOUNT'), emailKey);

    // Persist session before issuing cookie
    const { session, rawToken } = await this.sessionService.createSession(user.id, userAgent);

    return { user, session, rawToken };
  }
}
