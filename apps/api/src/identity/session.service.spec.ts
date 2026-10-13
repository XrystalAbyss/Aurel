import { SessionService } from './session.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { AuthSession, User, UserRole } from '@prisma/client';

describe('SessionService Unit Tests', () => {
  let service: SessionService;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockConfigService: jest.Mocked<ConfigService>;

  const mockDate = new Date('2026-10-12T10:00:00.000Z');
  const sampleUserId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

  const sampleUser: User = {
    id: sampleUserId,
    email: 'test@example.com',
    passwordHash: 'argon2id_hash',
    fullName: 'Test User',
    phone: null,
    role: UserRole.CUSTOMER,
    isActive: true,
    isPendingSetup: false,
    setupTokenDigest: null,
    setupTokenExpiresAt: null,
    createdAt: mockDate,
    updatedAt: mockDate,
  };

  const sampleSession: AuthSession = {
    id: 'b6e76cf0-7813-4375-9b2d-1fc0be16007b',
    userId: sampleUserId,
    tokenDigest: 'a'.repeat(64),
    createdAt: mockDate,
    expiresAt: new Date(mockDate.getTime() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    lastSeenAt: mockDate,
    userAgent: 'Mozilla/5.0 Test Agent',
  };

  let mockTx: {
    $queryRaw: jest.Mock;
    authSession: {
      create: jest.Mock;
    };
  };

  beforeEach(() => {
    mockTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: sampleUserId, is_active: true }]),
      authSession: {
        create: jest.fn().mockResolvedValue(sampleSession),
      },
    };

    mockPrisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback: (tx: unknown) => unknown) => callback(mockTx)),
      user: {
        findUnique: jest.fn().mockResolvedValue(sampleUser),
      },
      authSession: {
        create: jest.fn().mockResolvedValue(sampleSession),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(sampleSession),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as jest.Mocked<PrismaService>;

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'SESSION_SECRET') return 'test_session_secret_min_32_characters_123456';
        return defaultValue;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    service = new SessionService(mockPrisma, mockConfigService);
  });

  describe('generateOpaqueToken', () => {
    it('generates a 64-character hex string with 256 bits of entropy', () => {
      const token1 = service.generateOpaqueToken();
      const token2 = service.generateOpaqueToken();

      expect(token1).toHaveLength(64);
      expect(token2).toHaveLength(64);
      expect(token1).toMatch(/^[0-9a-f]{64}$/);
      expect(token1).not.toBe(token2);
    });
  });

  describe('computeTokenDigest', () => {
    it('computes a deterministic 64-character HMAC-SHA256 digest with server secret', () => {
      const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const digest1 = service.computeTokenDigest(token);
      const digest2 = service.computeTokenDigest(token);

      expect(digest1).toHaveLength(64);
      expect(digest1).toMatch(/^[0-9a-f]{64}$/);
      expect(digest1).toBe(digest2);
      expect(digest1).not.toBe(token);
    });

    it('produces distinct digests for different tokens', () => {
      const tokenA = service.generateOpaqueToken();
      const tokenB = service.generateOpaqueToken();

      expect(service.computeTokenDigest(tokenA)).not.toBe(service.computeTokenDigest(tokenB));
    });
  });

  describe('createSession', () => {
    it('persists session with token digest inside transaction with row lock and returns record and raw bearer token', async () => {
      mockTx.authSession.create.mockResolvedValue(sampleSession);

      const result = await service.createSession(sampleUserId, 'User-Agent-String');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.$queryRaw).toHaveBeenCalled();
      expect(result.rawToken).toHaveLength(64);
      expect(result.session).toEqual(sampleSession);

      expect(mockTx.authSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: sampleUserId,
          tokenDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
          userAgent: 'User-Agent-String',
        }),
      });

      // INVARIANT: Raw token must NEVER equal the token digest stored in the database
      const createCall = mockTx.authSession.create.mock.calls[0][0];
      expect(createCall.data.tokenDigest).not.toBe(result.rawToken);
    });

    it('truncates user agent exceeding 500 characters for data minimization', async () => {
      mockTx.authSession.create.mockResolvedValue(sampleSession);
      const longAgent = 'X'.repeat(600);

      await service.createSession(sampleUserId, longAgent);

      const createCall = mockTx.authSession.create.mock.calls[0][0];
      expect(createCall.data.userAgent).toHaveLength(500);
    });

    it('rejects session creation with UnauthorizedException if user account is deactivated', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: sampleUserId, is_active: false }]);

      await expect(service.createSession(sampleUserId)).rejects.toThrow();
    });

    it('rejects session creation if user record is not found under row lock', async () => {
      mockTx.$queryRaw.mockResolvedValue([]);

      await expect(service.createSession(sampleUserId)).rejects.toThrow();
    });
  });

  describe('validateSession', () => {
    const validRawToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    it('successfully validates an active, unexpired, unrevoked session for active user', async () => {
      const activeSession = {
        ...sampleSession,
        expiresAt: new Date(Date.now() + 3600000), // 1 hour in future
        revokedAt: null,
        user: sampleUser,
      };
      (mockPrisma.authSession.findUnique as jest.Mock).mockResolvedValue(activeSession);

      const result = await service.validateSession(validRawToken);

      expect(result).not.toBeNull();
      expect(result?.user).toEqual(sampleUser);
      expect(result?.session.id).toBe(activeSession.id);
    });

    it('rejects malformed token strings without querying database', async () => {
      expect(await service.validateSession('')).toBeNull();
      expect(await service.validateSession('too_short')).toBeNull();
      expect(await service.validateSession('a'.repeat(65))).toBeNull();
      expect(mockPrisma.authSession.findUnique).not.toHaveBeenCalled();
    });

    it('returns null if token digest is not found in database', async () => {
      (mockPrisma.authSession.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.validateSession(validRawToken);
      expect(result).toBeNull();
    });

    it('returns null if session has been revoked', async () => {
      const revokedSession = {
        ...sampleSession,
        revokedAt: new Date('2026-10-12T09:00:00Z'),
        user: sampleUser,
      };
      (mockPrisma.authSession.findUnique as jest.Mock).mockResolvedValue(revokedSession);

      const result = await service.validateSession(validRawToken);
      expect(result).toBeNull();
    });

    it('returns null if session has expired', async () => {
      const expiredSession = {
        ...sampleSession,
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
        revokedAt: null,
        user: sampleUser,
      };
      (mockPrisma.authSession.findUnique as jest.Mock).mockResolvedValue(expiredSession);

      const result = await service.validateSession(validRawToken);
      expect(result).toBeNull();
    });

    it('returns null if account has been deactivated (isActive === false)', async () => {
      const inactiveUser = { ...sampleUser, isActive: false };
      const sessionWithInactiveUser = {
        ...sampleSession,
        expiresAt: new Date(Date.now() + 3600000),
        revokedAt: null,
        user: inactiveUser,
      };
      (mockPrisma.authSession.findUnique as jest.Mock).mockResolvedValue(sessionWithInactiveUser);

      const result = await service.validateSession(validRawToken);
      expect(result).toBeNull();
    });
  });

  describe('revokeSession', () => {
    it('updates revokedAt timestamp for the matching token digest', async () => {
      (mockPrisma.authSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const success = await service.revokeSession(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      );

      expect(success).toBe(true);
      expect(mockPrisma.authSession.updateMany).toHaveBeenCalledWith({
        where: {
          tokenDigest: expect.any(String),
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });
    });

    it('returns false if session was already revoked or not found', async () => {
      (mockPrisma.authSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const success = await service.revokeSession(
        'non_existent_token_hex_value_0123456789abcdef0123456789abcdef12',
      );
      expect(success).toBe(false);
    });
  });

  describe('revokeAllUserSessions', () => {
    it('revokes all unrevoked sessions belonging to the user ID', async () => {
      (mockPrisma.authSession.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

      const count = await service.revokeAllUserSessions(sampleUserId);

      expect(count).toBe(3);
      expect(mockPrisma.authSession.updateMany).toHaveBeenCalledWith({
        where: {
          userId: sampleUserId,
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('deletes sessions whose expiresAt timestamp is in the past', async () => {
      (mockPrisma.authSession.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });

      const count = await service.cleanupExpiredSessions();

      expect(count).toBe(5);
      expect(mockPrisma.authSession.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
        },
      });
    });
  });
});
