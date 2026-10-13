import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { PasswordService } from '../identity/password.service';
import { bootstrapInitialAdmin } from '../staff/admin-bootstrap';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function promptInput(query: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(query, (ans) => {
        rl.close();
        resolve(ans.trim());
      });
      return;
    }

    if (hidden) {
      process.stdout.write(query);
      const stdin = process.stdin;
      stdin.resume();
      stdin.setRawMode(true);
      stdin.setEncoding('utf8');

      let password = '';
      const onData = (ch: string) => {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(password.trim());
        } else if (ch === '\u0003') {
          process.exit(1);
        } else if (ch === '\b' || ch === '\x7f') {
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else {
          password += ch;
        }
      };
      stdin.on('data', onData);
    } else {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(query, (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    }
  });
}

export async function runSeed(): Promise<void> {
  const connectionString =
    process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL
      ? process.env.TEST_DATABASE_URL
      : process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('Error: DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  // Explicit Database Target Guard: Protect production from accidental bootstrapping
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && process.env.ALLOW_PRODUCTION_ADMIN_SEED !== 'true') {
    console.error(
      '[TARGET GUARD] Refusing admin bootstrap on production target without ALLOW_PRODUCTION_ADMIN_SEED=true',
    );
    process.exit(1);
  }

  let email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  let password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const fullName = process.env.ADMIN_BOOTSTRAP_NAME;

  if (process.env.ADMIN_BOOTSTRAP_PASSWORD) {
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
  }

  if (!email && process.stdin.isTTY) {
    email = await promptInput('Enter initial administrator email: ');
  }
  if (!password && process.stdin.isTTY) {
    password = await promptInput('Enter initial administrator password: ', true);
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  const passwordService = new PasswordService();

  try {
    const result = await bootstrapInitialAdmin(prisma, passwordService, {
      email,
      password,
      fullName,
    });
    if (result.success) {
      console.log(`[SUCCESS] ${result.message}`);
      process.exit(0);
    } else {
      console.error(`[REFUSED] ${result.message}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[ERROR] Fatal bootstrap error: ${(err as Error).message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  runSeed();
}
