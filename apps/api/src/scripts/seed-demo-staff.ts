import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';
import { PasswordService } from '../identity/password.service';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface DatabaseTargetValidation {
  valid: boolean;
  reason?: string;
  hostname?: string;
  database?: string;
}

/**
 * Validates that the database connection target is an explicitly authorized,
 * isolated local demo or test database environment.
 * Fails closed on malformed URLs, non-local hosts, non-demo databases, or production environments.
 */
export function validateDemoDatabaseTarget(
  connectionString?: string,
  nodeEnv = process.env.NODE_ENV,
): DatabaseTargetValidation {
  if (nodeEnv === 'production') {
    return {
      valid: false,
      reason: 'Demo staff seeding is strictly prohibited in production environments.',
    };
  }

  if (!connectionString || typeof connectionString !== 'string' || !connectionString.trim()) {
    return {
      valid: false,
      reason: 'DATABASE_URL environment variable is required.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return {
      valid: false,
      reason: 'DATABASE_URL is not a valid URL connection string.',
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);
  if (!allowedHosts.has(hostname) && process.env.ALLOW_REMOTE_DEMO_DB !== 'true') {
    return {
      valid: false,
      reason: `Target host '${hostname}' is not an authorized local demo database host. Refusing execution.`,
      hostname,
    };
  }

  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
  if (!dbName) {
    return {
      valid: false,
      reason: 'DATABASE_URL does not specify a target database name.',
    };
  }

  const isAllowedDb =
    dbName === 'aurel_dev' ||
    dbName === 'aurel_test' ||
    dbName === 'aurel_demo' ||
    dbName.endsWith('_dev') ||
    dbName.endsWith('_test') ||
    dbName.endsWith('_demo');

  if (!isAllowedDb) {
    return {
      valid: false,
      reason: `Target database '${dbName}' is not an authorized demo target. Must match aurel_dev, aurel_test, aurel_demo, or end with _dev/_test/_demo.`,
      hostname,
      database: dbName,
    };
  }

  return {
    valid: true,
    hostname,
    database: dbName,
  };
}

export interface SeedDemoStaffResult {
  success: boolean;
  message: string;
  created: string[];
  preserved: string[];
  refused: string[];
}

export async function seedDemoStaff(
  prisma: PrismaClient,
  passwordService: PasswordService,
  options?: {
    connectionString?: string;
    demoPassword?: string;
  },
): Promise<SeedDemoStaffResult> {
  const connectionString = options?.connectionString || process.env.DATABASE_URL;
  const targetCheck = validateDemoDatabaseTarget(connectionString);
  if (!targetCheck.valid) {
    return {
      success: false,
      message: targetCheck.reason || 'Database target validation failed.',
      created: [],
      preserved: [],
      refused: [],
    };
  }

  const demoPassword =
    options?.demoPassword || process.env.DEMO_STAFF_PASSWORD || 'OperationsPassword2026!';

  const demoAccounts = [
    {
      email: 'admin@aurel.restaurant',
      fullName: 'Aurel Head Admin',
      role: UserRole.ADMIN,
    },
    {
      email: 'staff@aurel.restaurant',
      fullName: 'Aurel Floor Captain',
      role: UserRole.STAFF,
    },
    {
      email: 'kitchen@aurel.restaurant',
      fullName: 'Aurel Chef de Cuisine',
      role: UserRole.KITCHEN,
    },
  ];

  const created: string[] = [];
  const preserved: string[] = [];
  const refused: string[] = [];

  // Atomic transaction to prevent partial state on failure
  await prisma.$transaction(async (tx) => {
    for (const acc of demoAccounts) {
      const existing = await tx.user.findUnique({
        where: { email: acc.email },
      });

      if (existing) {
        // Invariant 1: NEVER silently elevate a CUSTOMER identity
        if (existing.role === UserRole.CUSTOMER) {
          refused.push(acc.email);
          console.warn(
            `[REFUSED] Account '${acc.email}' exists as CUSTOMER; refusing silent elevation.`,
          );
          continue;
        }

        // Invariant 2: NEVER overwrite existing ADMINISTRATOR credentials
        if (existing.role === UserRole.ADMIN) {
          preserved.push(acc.email);
          console.log(
            `[PRESERVED] Existing administrator '${acc.email}' preserved; refusing credential overwrite.`,
          );
          continue;
        }

        // Invariant 3: Preserve existing staff identities without overwriting
        preserved.push(acc.email);
        console.log(
          `[PRESERVED] Existing staff identity '${acc.email}' (${existing.role}) preserved without mutation.`,
        );
        continue;
      }

      // Safe creation: Only create if identity does not exist
      const passwordHash = await passwordService.hash(demoPassword);
      await tx.user.create({
        data: {
          email: acc.email,
          fullName: acc.fullName,
          role: acc.role,
          passwordHash,
          isActive: true,
          isPendingSetup: false,
        },
      });
      created.push(acc.email);
      console.log(`[CREATED] Demo staff identity: ${acc.email} (${acc.role})`);
    }
  });

  return {
    success: true,
    message: `Seeding completed: ${created.length} created, ${preserved.length} preserved, ${refused.length} refused.`,
    created,
    preserved,
    refused,
  };
}

export async function runDemoStaffSeed(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const targetCheck = validateDemoDatabaseTarget(connectionString);

  if (!targetCheck.valid) {
    console.error(`[CRITICAL TARGET GUARD] Refusing seed execution: ${targetCheck.reason}`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  const passwordService = new PasswordService();

  try {
    console.log(
      `Seeding demo staff accounts on target '${targetCheck.database}' (${targetCheck.hostname})...`,
    );
    const result = await seedDemoStaff(prisma, passwordService);
    if (result.success) {
      console.log(`[SUCCESS] ${result.message}`);
      process.exit(0);
    } else {
      console.error(`[REFUSED] ${result.message}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`[ERROR] Failed to seed demo staff: ${err.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  runDemoStaffSeed();
}
