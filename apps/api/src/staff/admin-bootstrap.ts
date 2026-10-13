import { PrismaClient, AuditAction } from '@prisma/client';
import { PasswordService } from '../identity/password.service';
import { UserRole } from '@aurel/shared-types';

export interface AdminBootstrapOptions {
  email?: string;
  password?: string;
  fullName?: string;
  phone?: string;
}

export interface AdminBootstrapResult {
  success: boolean;
  message: string;
  admin?: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
  };
}

export const ADMIN_MUTATION_LOCK_KEY = 424001;

/**
 * Core business logic for bootstrapping the initial administrator account.
 * Atomically creates the administrator and audit log record, and guards against re-bootstrap and collision.
 * Serialized at the PostgreSQL level via a transaction-scoped advisory lock.
 */
export async function bootstrapInitialAdmin(
  prisma: PrismaClient,
  passwordService: PasswordService,
  options: AdminBootstrapOptions,
): Promise<AdminBootstrapResult> {
  const rawEmail = options.email || process.env.ADMIN_BOOTSTRAP_EMAIL;
  const rawPassword = options.password || process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const fullName = (
    options.fullName ||
    process.env.ADMIN_BOOTSTRAP_NAME ||
    'System Administrator'
  ).trim();
  const phone = (options.phone || process.env.ADMIN_BOOTSTRAP_PHONE || '').trim();

  // Defensive: Immediately delete plain password from process.env if present
  if (process.env.ADMIN_BOOTSTRAP_PASSWORD) {
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
  }

  if (!rawEmail || typeof rawEmail !== 'string' || !rawEmail.includes('@')) {
    return {
      success: false,
      message: 'Bootstrap failed: Invalid or missing administrator email address.',
    };
  }

  if (!rawPassword || typeof rawPassword !== 'string' || rawPassword.length < 8) {
    return {
      success: false,
      message: 'Bootstrap failed: Password must be at least 8 characters long.',
    };
  }

  const canonicalEmail = rawEmail.trim().toLowerCase();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 0. Database-level serialization: acquire transaction-scoped advisory lock
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_MUTATION_LOCK_KEY});`;

      // 1. Check if ANY active administrator already exists
      const activeAdminCount = await tx.user.count({
        where: {
          role: UserRole.ADMIN,
          isActive: true,
        },
      });

      if (activeAdminCount > 0) {
        throw new Error(
          'REFUSED_ADMIN_EXISTS: An active administrator already exists in the system. Bootstrap aborted.',
        );
      }

      // 2. Check if the target email is already registered as an existing non-admin user
      const existingUser = await tx.user.findUnique({
        where: { email: canonicalEmail },
      });

      if (existingUser) {
        throw new Error(
          'REFUSED_EMAIL_EXISTS: Target email address is already registered to an existing account. Silent privilege elevation is refused.',
        );
      }

      // 3. Hash password with Argon2id using standardized PasswordService
      const passwordHash = await passwordService.hash(rawPassword);

      // 4. Create the initial administrator user
      const newAdmin = await tx.user.create({
        data: {
          email: canonicalEmail,
          passwordHash,
          fullName,
          phone: phone || null,
          role: UserRole.ADMIN,
          isActive: true,
          isPendingSetup: false,
        },
      });

      // 5. Create immutable audit log in the same transaction
      await tx.auditLog.create({
        data: {
          actorId: newAdmin.id,
          targetId: newAdmin.id,
          action: AuditAction.INITIAL_ADMIN_BOOTSTRAPPED,
          metadata: {
            email: canonicalEmail,
            role: UserRole.ADMIN,
          },
        },
      });

      return newAdmin;
    });

    return {
      success: true,
      message: `Initial administrator bootstrapped successfully for: ${canonicalEmail}`,
      admin: {
        id: result.id,
        email: result.email,
        fullName: result.fullName,
        role: result.role as UserRole,
      },
    };
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('REFUSED_ADMIN_EXISTS')) {
      return {
        success: false,
        message: 'Bootstrap refused: An active administrator already exists in the system.',
      };
    }
    if (err.message.includes('REFUSED_EMAIL_EXISTS')) {
      return {
        success: false,
        message:
          'Bootstrap refused: Target email address is already registered to an existing account.',
      };
    }
    return {
      success: false,
      message: `Bootstrap failed: ${err.message}`,
    };
  }
}
