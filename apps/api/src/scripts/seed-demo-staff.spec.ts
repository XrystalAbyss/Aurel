import { validateDemoDatabaseTarget, seedDemoStaff } from './seed-demo-staff';
import { UserRole } from '@prisma/client';
import { PasswordService } from '../identity/password.service';

describe('Demo Staff Seeding Safety & Target Guard (Gate 1)', () => {
  let mockPasswordService: PasswordService;

  beforeEach(() => {
    mockPasswordService = {
      hash: jest.fn().mockResolvedValue('argon2id_mock_hash'),
      verify: jest.fn().mockResolvedValue(true),
    } as unknown as PasswordService;
  });

  describe('Database Target Validation (validateDemoDatabaseTarget)', () => {
    it('succeeds for preferred isolated local evaluation target (aurel_demo) without extra flags', () => {
      const res = validateDemoDatabaseTarget(
        'postgresql://postgres:pass@127.0.0.1:5432/aurel_demo?schema=public',
        'development',
      );
      expect(res.valid).toBe(true);
      expect(res.database).toBe('aurel_demo');
      expect(res.hostname).toBe('127.0.0.1');
    });

    it('succeeds for automated test database target (aurel_test) without extra flags', () => {
      const res = validateDemoDatabaseTarget(
        'postgresql://postgres:pass@localhost:5432/aurel_test?schema=public',
        'test',
      );
      expect(res.valid).toBe(true);
      expect(res.database).toBe('aurel_test');
    });

    it('rejects target database aurel_dev when explicit opt-in flag is missing', () => {
      const res = validateDemoDatabaseTarget(
        'postgresql://postgres:pass@127.0.0.1:5432/aurel_dev?schema=public',
        'development',
        'false',
      );
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('ALLOW_DEV_DB_DEMO_SEED=true');
    });

    it('succeeds for target database aurel_dev when explicit opt-in flag ALLOW_DEV_DB_DEMO_SEED=true is set', () => {
      const res = validateDemoDatabaseTarget(
        'postgresql://postgres:pass@127.0.0.1:5432/aurel_dev?schema=public',
        'development',
        'true',
      );
      expect(res.valid).toBe(true);
      expect(res.database).toBe('aurel_dev');
    });

    it('rejects arbitrary database names with wildcards (e.g., custom_dev, my_demo, shop_test)', () => {
      const resDev = validateDemoDatabaseTarget(
        'postgresql://postgres:pass@127.0.0.1:5432/custom_dev',
        'development',
      );
      expect(resDev.valid).toBe(false);
      expect(resDev.reason).toContain('not an authorized demo target');

      const resDemo = validateDemoDatabaseTarget(
        'postgresql://postgres:pass@127.0.0.1:5432/my_demo',
        'development',
      );
      expect(resDemo.valid).toBe(false);
      expect(resDemo.reason).toContain('not an authorized demo target');
    });

    it('strictly rejects execution when NODE_ENV is production regardless of database name or flags', () => {
      const res = validateDemoDatabaseTarget(
        'postgresql://postgres:pass@127.0.0.1:5432/aurel_demo?schema=public',
        'production',
        'true',
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

    it('strictly rejects remote database hosts even if override environment variable was set', () => {
      const originalEnv = process.env.ALLOW_REMOTE_DEMO_DB;
      process.env.ALLOW_REMOTE_DEMO_DB = 'true';
      try {
        const res = validateDemoDatabaseTarget(
          'postgresql://admin:secret@rds.us-east-1.amazonaws.com:5432/aurel_demo',
          'development',
        );
        expect(res.valid).toBe(false);
        expect(res.reason).toContain('restricted strictly to local interfaces');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.ALLOW_REMOTE_DEMO_DB;
        } else {
          process.env.ALLOW_REMOTE_DEMO_DB = originalEnv;
        }
      }
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
        $queryRaw: jest.fn().mockResolvedValue([{ current_database: 'aurel_demo' }]),
      };
    });

    it('safely provisions accounts on aurel_demo when none exist', async () => {
      mockTx.user.findUnique.mockResolvedValue(null);
      mockTx.user.create.mockResolvedValue({ id: 'uuid-1' });

      const result = await seedDemoStaff(mockPrisma, mockPasswordService, {
        connectionString: 'postgresql://postgres:pass@127.0.0.1:5432/aurel_demo',
        demoPassword: 'TestPassword2026!',
      });

      expect(result.success).toBe(true);
      expect(result.created.length).toBe(3);
      expect(mockTx.user.create).toHaveBeenCalledTimes(3);
      expect(mockTx.user.update).not.toHaveBeenCalled();
    });

    it('refuses execution if active PostgreSQL current_database mismatch occurs', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ current_database: 'other_database' }]);

      const result = await seedDemoStaff(mockPrisma, mockPasswordService, {
        connectionString: 'postgresql://postgres:pass@127.0.0.1:5432/aurel_demo',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Database connection target mismatch');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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
        connectionString: 'postgresql://postgres:pass@127.0.0.1:5432/aurel_demo',
      });

      expect(result.refused).toContain('staff@aurel.restaurant');
      expect(mockTx.user.update).not.toHaveBeenCalled();
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
        connectionString: 'postgresql://postgres:pass@127.0.0.1:5432/aurel_demo',
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
        connectionString: 'postgresql://postgres:pass@127.0.0.1:5432/aurel_demo',
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
          connectionString: 'postgresql://postgres:pass@127.0.0.1:5432/aurel_demo',
        }),
      ).rejects.toThrow('PostgreSQL connection drop');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });
});
