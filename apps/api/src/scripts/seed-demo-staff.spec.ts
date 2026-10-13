import { validateDemoDatabaseTarget, seedDemoStaff } from './seed-demo-staff';
import { UserRole } from '@prisma/client';
import { PasswordService } from '../identity/password.service';

describe('Demo Staff Seeding Safety & Target Guard (Gate C)', () => {
  let mockPasswordService: PasswordService;

  beforeEach(() => {
    mockPasswordService = {
      hash: jest.fn().mockResolvedValue('argon2id_mock_hash'),
      verify: jest.fn().mockResolvedValue(true),
    } as unknown as PasswordService;
  });

  describe('Database Target Validation (validateDemoDatabaseTarget)', () => {
    it('succeeds for allowed isolated local demo database target (aurel_dev)', () => {
      const res = validateDemoDatabaseTarget(
        'postgresql://postgres:pass@127.0.0.1:5432/aurel_dev?schema=public',
        'development',
      );
      expect(res.valid).toBe(true);
      expect(res.database).toBe('aurel_dev');
      expect(res.hostname).toBe('127.0.0.1');
    });

    it('succeeds for localhost test target (aurel_test)', () => {
      const res = validateDemoDatabaseTarget(
        'postgresql://postgres:pass@localhost:5432/aurel_test?schema=public',
        'test',
      );
      expect(res.valid).toBe(true);
      expect(res.database).toBe('aurel_test');
    });

    it('succeeds for dedicated demo database target (aurel_demo)', () => {
      const res = validateDemoDatabaseTarget(
        'postgresql://postgres:pass@127.0.0.1:5432/aurel_demo?schema=public',
        'development',
      );
      expect(res.valid).toBe(true);
      expect(res.database).toBe('aurel_demo');
    });

    it('rejects execution when NODE_ENV is production unconditionally', () => {
      const res = validateDemoDatabaseTarget(
        'postgresql://postgres:pass@127.0.0.1:5432/aurel_dev?schema=public',
        'production',
      );
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('strictly prohibited in production');
    });

    it('rejects missing or empty DATABASE_URL', () => {
      const res = validateDemoDatabaseTarget('', 'development');
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('DATABASE_URL environment variable is required');
    });

    it('rejects malformed DATABASE_URL', () => {
      const res = validateDemoDatabaseTarget('not-a-url', 'development');
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('not a valid URL');
    });

    it('rejects unexpected remote database host (e.g. AWS RDS or remote IP)', () => {
      const res = validateDemoDatabaseTarget(
        'postgresql://admin:secret@rds.us-east-1.amazonaws.com:5432/aurel_dev',
        'development',
      );
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('not an authorized local demo database host');
    });

    it('rejects non-demo database target on localhost (e.g. production database or default postgres)', () => {
      const res = validateDemoDatabaseTarget(
        'postgresql://postgres:pass@127.0.0.1:5432/aurel_production',
        'development',
      );
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('not an authorized demo target');
    });
  });

  describe('Account Preservation & Safe Creation (seedDemoStaff)', () => {
    let mockTx: any;
    let mockPrisma: any;

    beforeEach(() => {
      mockTx = {
        user: {
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
      };

      mockPrisma = {
        $transaction: jest.fn((callback) => callback(mockTx)),
      };
    });

    it('safely provisions accounts when none exist on allowed target', async () => {
      mockTx.user.findUnique.mockResolvedValue(null);
      mockTx.user.create.mockResolvedValue({ id: 'uuid-1' });

      const result = await seedDemoStaff(mockPrisma, mockPasswordService, {
        connectionString: 'postgresql://postgres:pass@127.0.0.1:5432/aurel_dev',
        demoPassword: 'TestPassword2026!',
      });

      expect(result.success).toBe(true);
      expect(result.created.length).toBe(3);
      expect(mockTx.user.create).toHaveBeenCalledTimes(3);
      expect(mockTx.user.update).not.toHaveBeenCalled();
    });

    it('strictly refuses to elevate existing normal CUSTOMER account with matching demo email', async () => {
      mockTx.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.email === 'staff@aurel.restaurant') {
          return Promise.resolve({
            id: 'customer-uuid',
            email: 'staff@aurel.restaurant',
            role: UserRole.CUSTOMER,
            passwordHash: 'real_customer_password_hash',
          });
        }
        return Promise.resolve(null);
      });

      const result = await seedDemoStaff(mockPrisma, mockPasswordService, {
        connectionString: 'postgresql://postgres:pass@127.0.0.1:5432/aurel_dev',
      });

      expect(result.refused).toContain('staff@aurel.restaurant');
      expect(mockTx.user.update).not.toHaveBeenCalled();
      // Should not have created staff@aurel.restaurant
      expect(mockTx.user.create).toHaveBeenCalledTimes(2);
    });

    it('preserves existing administrator without overwriting credentials or assigning shared password', async () => {
      mockTx.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.email === 'admin@aurel.restaurant') {
          return Promise.resolve({
            id: 'admin-uuid',
            email: 'admin@aurel.restaurant',
            role: UserRole.ADMIN,
            passwordHash: 'custom_strong_admin_hash',
          });
        }
        return Promise.resolve(null);
      });

      const result = await seedDemoStaff(mockPrisma, mockPasswordService, {
        connectionString: 'postgresql://postgres:pass@127.0.0.1:5432/aurel_dev',
      });

      expect(result.preserved).toContain('admin@aurel.restaurant');
      expect(mockTx.user.update).not.toHaveBeenCalled();
      expect(mockTx.user.create).toHaveBeenCalledTimes(2);
    });

    it('re-running the seed preserves real identities and does not mutate existing data', async () => {
      mockTx.user.findUnique.mockImplementation(({ where }: any) => {
        return Promise.resolve({
          id: `id-${where.email}`,
          email: where.email,
          role: where.email.includes('admin')
            ? UserRole.ADMIN
            : where.email.includes('kitchen')
              ? UserRole.KITCHEN
              : UserRole.STAFF,
          passwordHash: 'existing_hash',
        });
      });

      const result = await seedDemoStaff(mockPrisma, mockPasswordService, {
        connectionString: 'postgresql://postgres:pass@127.0.0.1:5432/aurel_dev',
      });

      expect(result.success).toBe(true);
      expect(result.created.length).toBe(0);
      expect(result.preserved.length).toBe(3);
      expect(mockTx.user.create).not.toHaveBeenCalled();
      expect(mockTx.user.update).not.toHaveBeenCalled();
    });

    it('rolls back atomic transaction on unexpected failure without leaving partial accounts', async () => {
      mockTx.user.findUnique.mockResolvedValue(null);
      mockTx.user.create
        .mockResolvedValueOnce({ id: 'uuid-1' })
        .mockRejectedValueOnce(new Error('PostgreSQL connection drop'));

      await expect(
        seedDemoStaff(mockPrisma, mockPasswordService, {
          connectionString: 'postgresql://postgres:pass@127.0.0.1:5432/aurel_dev',
        }),
      ).rejects.toThrow('PostgreSQL connection drop');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });
});
