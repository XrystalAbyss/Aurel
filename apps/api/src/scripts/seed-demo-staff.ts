import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';
import { PasswordService } from '../identity/password.service';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export async function runDemoStaffSeed(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'CRITICAL: Demo staff seeding is strictly prohibited in production environments.',
    );
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Error: DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  const passwordService = new PasswordService();

  const demoPassword = process.env.DEMO_STAFF_PASSWORD || 'OperationsPassword2026!';

  const demoAccounts = [
    {
      email: 'admin@aurel.restaurant',
      fullName: 'Aurel Head Admin',
      role: UserRole.ADMIN,
      password: demoPassword,
    },
    {
      email: 'staff@aurel.restaurant',
      fullName: 'Aurel Floor Captain',
      role: UserRole.STAFF,
      password: demoPassword,
    },
    {
      email: 'kitchen@aurel.restaurant',
      fullName: 'Aurel Chef de Cuisine',
      role: UserRole.KITCHEN,
      password: demoPassword,
    },
  ];

  try {
    console.log('Seeding demo staff accounts for local operations demonstration...');
    for (const acc of demoAccounts) {
      const existing = await prisma.user.findUnique({
        where: { email: acc.email },
      });

      const passwordHash = await passwordService.hash(acc.password);

      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            role: acc.role,
            isActive: true,
            isPendingSetup: false,
          },
        });
        console.log(`[UPDATED] Demo staff identity: ${acc.email} (${acc.role})`);
      } else {
        await prisma.user.create({
          data: {
            email: acc.email,
            fullName: acc.fullName,
            role: acc.role,
            passwordHash,
            isActive: true,
            isPendingSetup: false,
          },
        });
        console.log(`[CREATED] Demo staff identity: ${acc.email} (${acc.role})`);
      }
    }
    console.log('All demo staff accounts successfully provisioned!');
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
