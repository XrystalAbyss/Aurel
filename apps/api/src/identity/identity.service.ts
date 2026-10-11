import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '@aurel/shared-types';
import { PasswordService } from './password.service';
import { UsersRepository } from './users.repository';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { PublicUserResponseDto } from './dto/public-user-response.dto';

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordService: PasswordService,
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
   * 1. Normalizes the email address.
   * 2. Hashes password using Argon2id.
   * 3. Creates the user record in PostgreSQL.
   * 4. Intercepts database unique constraint violations (P2002) and returns HTTP 409 Conflict.
   * 5. Returns a sanitized public account response.
   * NOTE: This method does NOT issue a session or token (deferred to P2.2).
   */
  async registerCustomer(dto: RegisterCustomerDto): Promise<PublicUserResponseDto> {
    const canonicalEmail = this.canonicalizeEmail(dto.email);

    // Fast-fail availability pre-check (database unique index remains authoritative)
    const existingUser = await this.usersRepository.findByEmail(canonicalEmail);
    if (existingUser) {
      this.logger.warn(`Registration rejected: canonical email already exists`);
      throw new ConflictException({
        message: 'An account with this email address already exists.',
        code: ErrorCode.CONFLICT,
        error: 'Conflict',
      });
    }

    const passwordHash = await this.passwordService.hash(dto.password);

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

      this.logger.error(
        `Unexpected database failure during user registration: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        message: 'Unable to process registration at this time.',
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  }
}
