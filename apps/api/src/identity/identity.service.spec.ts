import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { Prisma, User, UserRole } from '@prisma/client';
import { IdentityService } from './identity.service';
import { UsersRepository } from './users.repository';
import { PasswordService } from './password.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';

describe('IdentityService', () => {
  let service: IdentityService;
  let mockUsersRepository: jest.Mocked<UsersRepository>;
  let mockPasswordService: jest.Mocked<PasswordService>;

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
    } as unknown as jest.Mocked<PasswordService>;

    service = new IdentityService(mockUsersRepository, mockPasswordService);
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

      const result = await service.registerCustomer(validDto);

      // Verify canonicalization passed to persistence
      expect(mockUsersRepository.findByEmail).toHaveBeenCalledWith('jane.doe@example.com');
      expect(mockPasswordService.hash).toHaveBeenCalledWith('SecurePassword123!');
      expect(mockUsersRepository.createUser).toHaveBeenCalledWith({
        email: 'jane.doe@example.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$mockHashString',
        fullName: 'Jane Customer',
        phone: '+919876543210',
      });

      // Verify sanitized response contract
      expect(result.id).toBe(sampleUser.id);
      expect(result.email).toBe(sampleUser.email);
      expect(result.fullName).toBe(sampleUser.fullName);
      expect(result.phone).toBe(sampleUser.phone);
      expect(result.isActive).toBe(true);
      expect(result.createdAt).toBe(mockDate.toISOString());

      // Invariant: passwordHash and role must NEVER leak in the response DTO
      expect((result as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).role).toBeUndefined();
    });

    it('should throw ConflictException (409) if email is detected during availability pre-check', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(sampleUser);

      await expect(service.registerCustomer(validDto)).rejects.toThrow(ConflictException);

      expect(mockPasswordService.hash).not.toHaveBeenCalled();
      expect(mockUsersRepository.createUser).not.toHaveBeenCalled();
    });

    it('should throw ConflictException (409) when concurrent registration race triggers Prisma P2002', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('hash123');

      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`email`)',
        {
          code: 'P2002',
          clientVersion: '7.10.0',
        },
      );
      mockUsersRepository.createUser.mockRejectedValue(p2002Error);

      await expect(service.registerCustomer(validDto)).rejects.toThrow(ConflictException);
    });

    it('should throw InternalServerErrorException (500) and sanitize error on unexpected database failures', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('hash123');
      mockUsersRepository.createUser.mockRejectedValue(
        new Error('Connection terminated unexpectedly'),
      );

      await expect(service.registerCustomer(validDto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should never issue sessions, cookies, or JWTs upon registration', async () => {
      mockUsersRepository.findByEmail.mockResolvedValue(null);
      mockPasswordService.hash.mockResolvedValue('hash123');
      mockUsersRepository.createUser.mockResolvedValue(sampleUser);

      const result = await service.registerCustomer(validDto);

      expect((result as unknown as Record<string, unknown>).token).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).accessToken).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).session).toBeUndefined();
    });
  });
});
