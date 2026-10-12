import {
  ConflictException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, User, UserRole, AuthSession } from '@prisma/client';
import { IdentityService } from './identity.service';
import { UsersRepository } from './users.repository';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { RateLimiterService } from './rate-limiter.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { LoginDto } from './dto/login.dto';

describe('IdentityService', () => {
  let service: IdentityService;
  let mockUsersRepository: jest.Mocked<UsersRepository>;
  let mockPasswordService: jest.Mocked<PasswordService>;
  let mockSessionService: jest.Mocked<SessionService>;
  let mockRateLimiterService: jest.Mocked<RateLimiterService>;

  const mockDate = new Date('2026-10-11T18:00:00.000Z');

  const sampleUser: User = {
    id: 'b6e76cf0-7813-4375-9b2d-1fc0be16007b',
    email: 'customer@example.com',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$mockHashString',
    fullName: 'Jane Customer',
    phone: '+919876543210',
    role: UserRole.CUSTOMER,
    isActive: true,
    createdAt: mockDate,
    updatedAt: mockDate,
  };

  const sampleSession: AuthSession = {
    id: 'c1d2e3f4-5678-90ab-cdef-1234567890ab',
    userId: sampleUser.id,
    tokenDigest: 'mock_sha256_token_digest_64_characters_long_for_unit_tests_12345678',
    createdAt: mockDate,
    expiresAt: new Date(mockDate.getTime() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    lastSeenAt: mockDate,
    userAgent: 'Jest Test Agent',
  };

  beforeEach(() => {
    mockUsersRepository = {
      createUser: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      deleteById: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;

    mockPasswordService = {
      hash: jest.fn(),
      verify: jest.fn(),
      verifyDummy: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<PasswordService>;

    mockSessionService = {
      createSession: jest.fn().mockResolvedValue({
        session: sampleSession,
        rawToken: 'mock_raw_bearer_token_64_chars_long_entropy_hex_abcdef1234567890',
      }),
      validateSession: jest.fn(),
      revokeSession: jest.fn(),
      revokeAllUserSessions: jest.fn(),
      cleanupExpiredSessions: jest.fn(),
    } as unknown as jest.Mocked<SessionService>;

    mockRateLimiterService = {
      consume: jest.fn(),
      reset: jest.fn(),
      getPolicy: jest.fn().mockImplementation((type: string) => ({
        keyPrefix: `rate:${type}`,
        maxAttempts: 10,
        windowSeconds: 60,
      })),
      hashIdentifier: jest.fn((id: string) => `hashed_${id}`),
      acquireHashSlot: jest.fn().mockResolvedValue(() => {}),
      extractClientIp: jest.fn().mockReturnValue('127.0.0.1'),
    } as unknown as jest.Mocked<RateLimiterService>;

    service = new IdentityService(
      mockUsersRepository,
      mockPasswordService,
      mockSessionService,
      mockRateLimiterService,
    );
  });

  describe('canonicalizeEmail', () => {
    it('should trim surrounding whitespace and lowercase uppercase letters', () => {
      expect(service.canonicalizeEmail('   User@EXAMPLE.COM   ')).toBe('user@example.com');
      expect(service.canonicalizeEmail('Jane.Doe+Tag@Domain.Org')).toBe('jane.doe+tag@domain.org');
    });
  });

  describe('registerCustomer', () => {
    const validDto: RegisterCustomerDto = {
      email: '  Jane.Doe@EXAMPLE.COM  ',
      password: 'SecurePassword123!',
      fullName: '  Jane Customer  ',
      phone: '+919876543210',
    };

    it('should successfully register a customer and return a sanitized PublicUserResponseDto', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$v=19$m=65536,t=3,p=4$mockHashString');
      mockUsersRepository.createUser.mockResolvedValue(sampleUser);

      const result = await service.registerCustomer(validDto, '127.0.0.1');

      expect(mockRateLimiterService.consume).toHaveBeenCalledTimes(2);
      expect(mockUsersRepository.findByEmail).toHaveBeenCalledWith('jane.doe@example.com');
      expect(mockPasswordService.hash).toHaveBeenCalledWith('SecurePassword123!');
      expect(mockUsersRepository.createUser).toHaveBeenCalledWith({
        email: 'jane.doe@example.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$mockHashString',
        fullName: 'Jane Customer',
        phone: '+919876543210',
      });

      expect(result).toEqual({
        id: sampleUser.id,
        email: sampleUser.email,
        fullName: sampleUser.fullName,
        phone: sampleUser.phone,
        isActive: true,
        createdAt: mockDate.toISOString(),
      });
      expect((result as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).role).toBeUndefined();
    });

    it('should throw ConflictException if canonical email is already registered', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(sampleUser);

      await expect(service.registerCustomer(validDto)).rejects.toThrow(ConflictException);
      expect(mockPasswordService.hash).not.toHaveBeenCalled();
      expect(mockUsersRepository.createUser).not.toHaveBeenCalled();
    });

    it('should catch database unique constraint violation (P2002) and throw ConflictException', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$v=19$m=65536,t=3,p=4$mockHashString');

      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.0',
      });
      mockUsersRepository.createUser.mockRejectedValue(p2002Error);

      await expect(service.registerCustomer(validDto)).rejects.toThrow(ConflictException);
    });

    it('should throw InternalServerErrorException on unexpected database errors', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('$argon2id$v=19$m=65536,t=3,p=4$mockHashString');
      mockUsersRepository.createUser.mockRejectedValue(
        new Error('Connection terminated unexpectedly'),
      );

      await expect(service.registerCustomer(validDto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('authenticateCustomer', () => {
    const validLoginDto: LoginDto = {
      email: '  Customer@Example.COM  ',
      password: 'CorrectPassphrase#42',
    };

    it('successfully authenticates with correct credentials and returns user, session, and raw token', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(sampleUser);
      mockPasswordService.verify.mockResolvedValue(true);

      const result = await service.authenticateCustomer(
        validLoginDto,
        '192.168.1.1',
        'Mozilla/5.0 Test Agent',
      );

      expect(mockRateLimiterService.consume).toHaveBeenCalledTimes(2);
      expect(mockUsersRepository.findByEmail).toHaveBeenCalledWith('customer@example.com');
      expect(mockPasswordService.verify).toHaveBeenCalledWith(
        sampleUser.passwordHash,
        'CorrectPassphrase#42',
      );
      expect(mockRateLimiterService.reset).toHaveBeenCalledWith(
        expect.anything(),
        'hashed_customer@example.com',
      );
      expect(mockSessionService.createSession).toHaveBeenCalledWith(
        sampleUser.id,
        'Mozilla/5.0 Test Agent',
      );

      expect(result.user).toEqual(sampleUser);
      expect(result.session).toEqual(sampleSession);
      expect(result.rawToken).toBeDefined();
    });

    it('rejects with generic UnauthorizedException and runs dummy verify when email is unknown', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);

      await expect(service.authenticateCustomer(validLoginDto, '192.168.1.1')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockPasswordService.verifyDummy).toHaveBeenCalledWith('CorrectPassphrase#42');
      expect(mockPasswordService.verify).not.toHaveBeenCalled();
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
    });

    it('rejects with generic UnauthorizedException when password verification fails', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(sampleUser);
      mockPasswordService.verify.mockResolvedValue(false);

      await expect(service.authenticateCustomer(validLoginDto, '192.168.1.1')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockPasswordService.verify).toHaveBeenCalledWith(
        sampleUser.passwordHash,
        'CorrectPassphrase#42',
      );
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
      expect(mockRateLimiterService.reset).not.toHaveBeenCalled();
    });

    it('rejects with generic UnauthorizedException when account is inactive', async () => {
      const inactiveUser: User = { ...sampleUser, isActive: false };
      mockUsersRepository.findByEmail.mockResolvedValue(inactiveUser);
      mockPasswordService.verify.mockResolvedValue(true);

      await expect(service.authenticateCustomer(validLoginDto, '192.168.1.1')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockSessionService.createSession).not.toHaveBeenCalled();
    });
  });
});
