import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { User, AuditAction } from '@prisma/client';
import {
  UserRole,
  Permission,
  hasPermission,
  ErrorCode,
  PaginatedResponse,
} from '@aurel/shared-types';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../identity/password.service';
import { SessionService } from '../identity/session.service';
import { ADMIN_MUTATION_LOCK_KEY } from './admin-bootstrap';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffRoleDto } from './dto/update-staff-role.dto';
import { UpdateStaffStatusDto } from './dto/update-staff-status.dto';
import { QueryStaffDto } from './dto/query-staff.dto';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { StaffUserResponseDto } from './dto/staff-user-response.dto';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';

import { StaffInvitationInbox } from './invitation-inbox';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  /**
   * Helper for test fixtures to retrieve the issued single-use setup token.
   */
  static getIssuedSetupToken(email: string): string | undefined {
    return StaffInvitationInbox.getIssuedToken(email);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * Provisions a new staff member account and creates an immutable audit event in a single transaction.
   * Secures credential establishment via a single-use expiring setup token.
   */
  async createStaff(
    actor: User,
    dto: CreateStaffDto,
    clientIp?: string,
    requestId?: string,
  ): Promise<StaffUserResponseDto> {
    const actorRole = actor.role as UserRole;

    // Authorization policy for account creation
    if (actorRole === UserRole.MANAGER) {
      if (dto.role === UserRole.MANAGER || dto.role === UserRole.ADMIN) {
        throw new ForbiddenException({
          message: 'Managers cannot provision manager or administrator accounts.',
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }
    } else if (actorRole === UserRole.ADMIN) {
      if (dto.role === UserRole.ADMIN && !hasPermission(actorRole, Permission.ADMIN_CREATE)) {
        throw new ForbiddenException({
          message: 'Account lacks admin.create entitlement to provision administrators.',
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }
    } else {
      throw new ForbiddenException({
        message: 'Insufficient privileges to provision staff accounts.',
        code: ErrorCode.FORBIDDEN,
        error: 'Forbidden',
      });
    }

    // Production guard: fail closed if unmediated permanent password setting is attempted without approved invitation system
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DIRECT_STAFF_PASSWORD) {
      throw new ForbiddenException({
        message:
          'Direct staff password setting is disallowed in production. Secure invitation and self-service credential establishment is required.',
        code: ErrorCode.FORBIDDEN,
        error: 'Forbidden',
      });
    }

    const canonicalEmail = dto.email.trim().toLowerCase();
    const passwordHash = await this.passwordService.hash(dto.password);

    // Cryptographic single-use expiring setup token for credential establishment
    const rawSetupToken = crypto.randomBytes(32).toString('hex');
    const setupTokenDigest = crypto.createHash('sha256').update(rawSetupToken).digest('hex');
    const setupTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    return this.prisma.$transaction(async (tx) => {
      // If creating an ADMIN, serialize via PostgreSQL advisory lock
      if (dto.role === UserRole.ADMIN) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_MUTATION_LOCK_KEY});`;
      }

      // Gate G: Fresh actor authority validation inside transaction
      const currentActor = await tx.user.findUnique({ where: { id: actor.id } });
      if (!currentActor || !currentActor.isActive) {
        throw new ForbiddenException({
          message: 'Actor account is deactivated or invalid.',
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }
      const freshActorRole = currentActor.role as UserRole;
      if (freshActorRole === UserRole.MANAGER) {
        if (dto.role === UserRole.MANAGER || dto.role === UserRole.ADMIN) {
          throw new ForbiddenException({
            message: 'Managers cannot provision manager or administrator accounts.',
            code: ErrorCode.FORBIDDEN,
            error: 'Forbidden',
          });
        }
      } else if (freshActorRole === UserRole.ADMIN) {
        if (
          dto.role === UserRole.ADMIN &&
          !hasPermission(freshActorRole, Permission.ADMIN_CREATE)
        ) {
          throw new ForbiddenException({
            message: 'Account lacks admin.create entitlement to provision administrators.',
            code: ErrorCode.FORBIDDEN,
            error: 'Forbidden',
          });
        }
      } else {
        throw new ForbiddenException({
          message: 'Insufficient privileges to provision staff accounts.',
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }

      // Enforce email uniqueness with lock
      const existing = await tx.user.findUnique({
        where: { email: canonicalEmail },
      });

      if (existing) {
        throw new ConflictException({
          message: 'An account with this email address already exists.',
          code: ErrorCode.CONFLICT,
          error: 'Conflict',
        });
      }

      const newUser = await tx.user.create({
        data: {
          email: canonicalEmail,
          passwordHash,
          fullName: dto.fullName.trim(),
          phone: dto.phone?.trim() || null,
          role: dto.role,
          isActive: true,
          isPendingSetup: true,
          setupTokenDigest,
          setupTokenExpiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          targetId: newUser.id,
          action: AuditAction.STAFF_USER_CREATED,
          requestId: requestId || null,
          clientIp: clientIp || null,
          metadata: {
            role: newUser.role,
            email: newUser.email,
          },
        },
      });

      // Dispatch invitation via isolated non-production inbox adapter (fails closed in prod)
      StaffInvitationInbox.deliverInvitation(canonicalEmail, rawSetupToken, setupTokenExpiresAt);

      this.logger.log(
        `Staff account provisioned: ${newUser.id} (${newUser.role}) by actor: ${actor.id}`,
      );

      return StaffUserResponseDto.fromEntity(newUser);
    });
  }

  /**
   * Retrieves a paginated directory of staff accounts with role-based scoping.
   */
  async getStaffList(
    actor: User,
    query: QueryStaffDto,
  ): Promise<PaginatedResponse<StaffUserResponseDto>> {
    const actorRole = actor.role as UserRole;

    // Defense-in-depth: Least privilege check on directory listing
    if (!hasPermission(actorRole, Permission.STAFF_READ)) {
      throw new ForbiddenException({
        message: `Access forbidden: account lacks required permission '${Permission.STAFF_READ}'.`,
        code: ErrorCode.FORBIDDEN,
        error: 'Forbidden',
      });
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (actorRole === UserRole.ADMIN) {
      if (query.role) {
        where.role = query.role;
      } else {
        where.role = {
          in: [UserRole.STAFF, UserRole.KITCHEN, UserRole.MANAGER, UserRole.ADMIN],
        };
      }
    } else if (actorRole === UserRole.MANAGER) {
      // Managers can only list STAFF and KITCHEN
      if (query.role === UserRole.MANAGER || query.role === UserRole.ADMIN) {
        return { items: [], total: 0, page, limit, totalPages: 0 };
      }
      if (query.role) {
        where.role = query.role;
      } else {
        where.role = { in: [UserRole.STAFF, UserRole.KITCHEN] };
      }
    } else {
      // General staff/kitchen viewing directory
      where.role = { in: [UserRole.STAFF, UserRole.KITCHEN] };
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users.map(StaffUserResponseDto.fromEntity),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  /**
   * Retrieves an individual staff user by ID with manager boundary enforcement and self-profile scoping.
   */
  async getStaffById(actor: User, targetId: string): Promise<StaffUserResponseDto> {
    const actorRole = actor.role as UserRole;

    // Self-profile inspection is allowed for any authenticated staff
    if (actor.id !== targetId) {
      if (!hasPermission(actorRole, Permission.STAFF_READ)) {
        throw new ForbiddenException({
          message: `Access forbidden: account lacks required permission '${Permission.STAFF_READ}'.`,
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
    });

    if (!target) {
      throw new NotFoundException({
        message: 'Staff user not found.',
        code: ErrorCode.NOT_FOUND,
        error: 'Not Found',
      });
    }

    // Managers cannot inspect other manager or admin identities
    if (
      actorRole === UserRole.MANAGER &&
      actor.id !== targetId &&
      (target.role === UserRole.MANAGER || target.role === UserRole.ADMIN)
    ) {
      throw new ForbiddenException({
        message: 'Managers cannot inspect manager or administrator accounts.',
        code: ErrorCode.FORBIDDEN,
        error: 'Forbidden',
      });
    }

    return StaffUserResponseDto.fromEntity(target);
  }

  /**
   * Mutates a staff member's role, atomically revokes all their active sessions,
   * and records an audit log entry within the same PostgreSQL transaction.
   * Serialized at the PostgreSQL level via transaction-scoped advisory locking.
   */
  async updateStaffRole(
    actor: User,
    targetId: string,
    dto: UpdateStaffRoleDto,
    clientIp?: string,
    requestId?: string,
  ): Promise<StaffUserResponseDto> {
    const actorRole = actor.role as UserRole;

    // Invariant: Self-role mutation forbidden
    if (actor.id === targetId) {
      throw new ForbiddenException({
        message: 'Self-role modification is strictly prohibited.',
        code: ErrorCode.FORBIDDEN,
        error: 'Forbidden',
      });
    }

    // Invariant: Manager role assignment boundary
    if (actorRole === UserRole.MANAGER) {
      if (dto.role === UserRole.MANAGER || dto.role === UserRole.ADMIN) {
        throw new ForbiddenException({
          message: 'Managers cannot assign manager or administrator roles.',
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Gate A: PostgreSQL transaction-scoped advisory lock serializes global administrative invariants
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_MUTATION_LOCK_KEY});`;

      // Gate G: Fresh actor authority validation inside transaction
      const currentActor = await tx.user.findUnique({ where: { id: actor.id } });
      if (!currentActor || !currentActor.isActive) {
        throw new ForbiddenException({
          message: 'Actor account is deactivated or invalid.',
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }
      const freshActorRole = currentActor.role as UserRole;
      if (!hasPermission(freshActorRole, Permission.STAFF_ROLE_ASSIGN)) {
        throw new ForbiddenException({
          message: 'Actor lacks staff.role.assign permission.',
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }
      if (
        freshActorRole === UserRole.MANAGER &&
        (dto.role === UserRole.MANAGER || dto.role === UserRole.ADMIN)
      ) {
        throw new ForbiddenException({
          message: 'Managers cannot assign manager or administrator roles.',
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }

      // Row lock target
      const targets = await tx.$queryRaw<Array<User>>`
        SELECT id, email, full_name, phone, role, is_active, created_at, updated_at
        FROM users
        WHERE id = ${targetId}::uuid
        FOR UPDATE;
      `;

      if (!targets || targets.length === 0) {
        throw new NotFoundException({
          message: 'Target staff user not found.',
          code: ErrorCode.NOT_FOUND,
          error: 'Not Found',
        });
      }

      const target = targets[0];
      const targetRole = target.role as UserRole;

      // Manager cannot modify manager or admin accounts
      if (
        freshActorRole === UserRole.MANAGER &&
        (targetRole === UserRole.MANAGER || targetRole === UserRole.ADMIN)
      ) {
        throw new ForbiddenException({
          message: 'Managers cannot modify manager or administrator accounts.',
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }

      // Last active administrator protection: Cannot demote the final active admin
      if (targetRole === UserRole.ADMIN && dto.role !== UserRole.ADMIN) {
        const activeAdmins = await tx.user.count({
          where: { role: UserRole.ADMIN, isActive: true },
        });

        if (activeAdmins <= 1) {
          throw new ForbiddenException({
            message: 'Cannot demote the final active administrator in the system.',
            code: ErrorCode.FORBIDDEN,
            error: 'Forbidden',
          });
        }
      }

      const oldRole = targetRole;

      const updatedUser = await tx.user.update({
        where: { id: targetId },
        data: { role: dto.role },
      });

      // Atomically revoke all active sessions for the target user across all devices
      await this.sessionService.revokeAllUserSessions(targetId, tx);

      // Durable audit event insertion
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          targetId: targetId,
          action: AuditAction.USER_ROLE_UPDATED,
          requestId: requestId || null,
          clientIp: clientIp || null,
          metadata: {
            oldRole,
            newRole: dto.role,
          },
        },
      });

      this.logger.log(
        `Staff role updated: ${targetId} (${oldRole} -> ${dto.role}) by actor: ${actor.id}`,
      );

      return StaffUserResponseDto.fromEntity(updatedUser);
    });
  }

  /**
   * Activates or deactivates a staff account, atomically revokes all sessions on deactivation,
   * and records an audit log entry in a single transaction.
   * Serialized at the PostgreSQL level via transaction-scoped advisory locking.
   */
  async updateStaffStatus(
    actor: User,
    targetId: string,
    dto: UpdateStaffStatusDto,
    clientIp?: string,
    requestId?: string,
  ): Promise<StaffUserResponseDto> {
    // Invariant: Self-deactivation forbidden
    if (actor.id === targetId && !dto.isActive) {
      throw new ForbiddenException({
        message: 'Self-deactivation is strictly prohibited.',
        code: ErrorCode.FORBIDDEN,
        error: 'Forbidden',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // Gate A: PostgreSQL transaction-scoped advisory lock serializes global administrative invariants
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_MUTATION_LOCK_KEY});`;

      // Gate G: Fresh actor authority validation inside transaction
      const currentActor = await tx.user.findUnique({ where: { id: actor.id } });
      if (!currentActor || !currentActor.isActive) {
        throw new ForbiddenException({
          message: 'Actor account is deactivated or invalid.',
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }
      const freshActorRole = currentActor.role as UserRole;
      const requiredPerm = dto.isActive ? Permission.STAFF_ACTIVATE : Permission.STAFF_DEACTIVATE;
      if (!hasPermission(freshActorRole, requiredPerm)) {
        throw new ForbiddenException({
          message: `Actor lacks required permission '${requiredPerm}'.`,
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }

      // Row lock target
      const targets = await tx.$queryRaw<Array<User>>`
        SELECT id, email, full_name, phone, role, is_active, created_at, updated_at
        FROM users
        WHERE id = ${targetId}::uuid
        FOR UPDATE;
      `;

      if (!targets || targets.length === 0) {
        throw new NotFoundException({
          message: 'Target staff user not found.',
          code: ErrorCode.NOT_FOUND,
          error: 'Not Found',
        });
      }

      const target = targets[0];
      const targetRole = target.role as UserRole;

      // Manager cannot change status of manager or admin accounts
      if (
        freshActorRole === UserRole.MANAGER &&
        (targetRole === UserRole.MANAGER || targetRole === UserRole.ADMIN)
      ) {
        throw new ForbiddenException({
          message: 'Managers cannot modify manager or administrator accounts.',
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }

      // Last active administrator protection: Cannot deactivate the final active admin
      if (targetRole === UserRole.ADMIN && !dto.isActive) {
        const activeAdmins = await tx.user.count({
          where: { role: UserRole.ADMIN, isActive: true },
        });

        if (activeAdmins <= 1) {
          throw new ForbiddenException({
            message: 'Cannot deactivate the final active administrator in the system.',
            code: ErrorCode.FORBIDDEN,
            error: 'Forbidden',
          });
        }
      }

      const oldStatus = target.isActive;

      const updatedUser = await tx.user.update({
        where: { id: targetId },
        data: { isActive: dto.isActive },
      });

      // If deactivating, revoke all active sessions across all devices
      if (!dto.isActive) {
        await this.sessionService.revokeAllUserSessions(targetId, tx);
      }

      // Record durable audit event
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          targetId: targetId,
          action: dto.isActive ? AuditAction.USER_REACTIVATED : AuditAction.USER_DEACTIVATED,
          requestId: requestId || null,
          clientIp: clientIp || null,
          metadata: {
            oldStatus,
            newStatus: dto.isActive,
          },
        },
      });

      this.logger.log(
        `Staff status updated: ${targetId} (active: ${oldStatus} -> ${dto.isActive}) by actor: ${actor.id}`,
      );

      return StaffUserResponseDto.fromEntity(updatedUser);
    });
  }

  /**
   * Retrieves a paginated list of security audit trail records for administrators.
   */
  async getAuditLogs(query: QueryAuditLogsDto): Promise<PaginatedResponse<AuditLogResponseDto>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (query.action) {
      where.action = query.action;
    }

    if (query.targetId) {
      where.targetId = query.targetId;
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: logs.map(AuditLogResponseDto.fromEntity),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }
}
