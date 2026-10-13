import { PrismaClient, User, AuditLog, AuditAction } from '@prisma/client';
import { PasswordService } from '../identity/password.service';
import { bootstrapInitialAdmin } from './admin-bootstrap';
import { UserRole } from '@aurel/shared-types';

describe('Initial Administrator Bootstrap Logic Unit Tests', () => {
  let mockPrisma: jest.Mocked<PrismaClient>;
  let mockPasswordService: jest.Mocked<PasswordService>;

  beforeEach(() => {
    mockPasswordService = {
      hash: jest.fn().mockResolvedValue('$argon2id$v=19$m=65536,t=3,p=4$mockAdminHash'),
      verify: jest.fn(),
      verifyDummy: jest.fn(),
    } as unknown as jest.Mocked<PasswordService>;

    mockPrisma = {
      $transaction: jest.fn(),
    } as unknown as jest.Mocked<PrismaClient>;
  });

  afterEach(() => {
    delete process.env.ADMIN_BOOTSTRAP_EMAIL;
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    delete process.env.ADMIN_BOOTSTRAP_NAME;
  });

  it('should successfully bootstrap initial administrator on fresh database', async () => {
    const mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: {
        count: jest.fn().mockResolvedValue(0), // 0 active admins
        findUnique: jest.fn().mockResolvedValue(null), // email not taken
        create: jest.fn().mockResolvedValue({
          id: 'admin-uuid-1',
          email: 'admin@aurel.restaurant',
          fullName: 'Root Administrator',
          role: UserRole.ADMIN,
          isActive: true,
          createdAt: new Date(),
        } as User),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({} as AuditLog),
      },
    };

    mockPrisma.$transaction.mockImplementation(async (callback) => {
      return callback(mockTx as unknown as PrismaClient);
    });

    const result = await bootstrapInitialAdmin(mockPrisma, mockPasswordService, {
      email: '  Admin@Aurel.Restaurant  ',
      password: 'SecureBootstrapPassword123!',
      fullName: 'Root Administrator',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('Initial administrator bootstrapped successfully');
    expect(result.admin?.email).toBe('admin@aurel.restaurant');
    expect(result.admin?.role).toBe(UserRole.ADMIN);

    expect(mockTx.user.count).toHaveBeenCalledWith({
      where: { role: UserRole.ADMIN, isActive: true },
    });
    expect(mockTx.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@aurel.restaurant' },
    });
    expect(mockPasswordService.hash).toHaveBeenCalledWith('SecureBootstrapPassword123!');
    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-uuid-1',
        targetId: 'admin-uuid-1',
        action: AuditAction.INITIAL_ADMIN_BOOTSTRAPPED,
        metadata: {
          email: 'admin@aurel.restaurant',
          role: UserRole.ADMIN,
        },
      },
    });
  });

  it('should refuse re-bootstrap when an active administrator already exists in database', async () => {
    const mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: {
        count: jest.fn().mockResolvedValue(1), // 1 active admin already exists!
      },
    };

    mockPrisma.$transaction.mockImplementation(async (callback) => {
      return callback(mockTx as unknown as PrismaClient);
    });

    const result = await bootstrapInitialAdmin(mockPrisma, mockPasswordService, {
      email: 'newadmin@aurel.restaurant',
      password: 'SecureBootstrapPassword123!',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('An active administrator already exists in the system');
    expect(mockPasswordService.hash).not.toHaveBeenCalled();
  });

  it('should refuse bootstrap when target email belongs to an existing non-admin customer', async () => {
    const mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: {
        count: jest.fn().mockResolvedValue(0), // 0 admins
        findUnique: jest.fn().mockResolvedValue({
          id: 'existing-customer-uuid',
          email: 'customer@example.com',
          role: UserRole.CUSTOMER,
        } as User),
      },
    };

    mockPrisma.$transaction.mockImplementation(async (callback) => {
      return callback(mockTx as unknown as PrismaClient);
    });

    const result = await bootstrapInitialAdmin(mockPrisma, mockPasswordService, {
      email: 'customer@example.com',
      password: 'SecureBootstrapPassword123!',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain(
      'Target email address is already registered to an existing account',
    );
    expect(mockPasswordService.hash).not.toHaveBeenCalled();
  });

  it('should immediately delete ADMIN_BOOTSTRAP_PASSWORD from process.env if set', async () => {
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'TemporaryPasswordInEnv!';

    const result = await bootstrapInitialAdmin(mockPrisma, mockPasswordService, {
      email: '', // will fail validation
    });

    expect(result.success).toBe(false);
    expect(process.env.ADMIN_BOOTSTRAP_PASSWORD).toBeUndefined();
  });

  it('should reject invalid or short password candidate (< 8 chars)', async () => {
    const result = await bootstrapInitialAdmin(mockPrisma, mockPasswordService, {
      email: 'admin@example.com',
      password: 'short',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Password must be at least 8 characters long');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('should reject invalid email candidate', async () => {
    const result = await bootstrapInitialAdmin(mockPrisma, mockPasswordService, {
      email: 'not-an-email',
      password: 'SecurePassword123!',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid or missing administrator email address');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
