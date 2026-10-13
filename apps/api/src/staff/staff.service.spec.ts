import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffService } from './staff.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../identity/password.service';
import { SessionService } from '../identity/session.service';
import { UserRole, AuditAction } from '@aurel/shared-types';
import { User, Prisma } from '@prisma/client';

describe('StaffService Unit Tests', () => {
  let service: StaffService;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockPasswordService: jest.Mocked<PasswordService>;
  let mockSessionService: jest.Mocked<SessionService>;

  const managerUser: User = {
    id: 'manager-uuid-1',
    email: 'manager@aurel.restaurant',
    passwordHash: '$mockHash',
    fullName: 'Operational Manager',
    phone: null,
    role: UserRole.MANAGER,
    isActive: true,
    isPendingSetup: false,
    setupTokenDigest: null,
    setupTokenExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const adminUser: User = {
    id: 'admin-uuid-1',
    email: 'admin@aurel.restaurant',
    passwordHash: '$mockHash',
    fullName: 'System Administrator',
    phone: null,
    role: UserRole.ADMIN,
    isActive: true,
    isPendingSetup: false,
    setupTokenDigest: null,
    setupTokenExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const staffUser: User = {
    id: 'staff-uuid-1',
    email: 'staff@aurel.restaurant',
    passwordHash: '$mockHash',
    fullName: 'Wait Staff',
    phone: null,
    role: UserRole.STAFF,
    isActive: true,
    isPendingSetup: false,
    setupTokenDigest: null,
    setupTokenExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn(),
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    mockPasswordService = {
      hash: jest.fn().mockResolvedValue('$argon2id$v=19$mockHash'),
      verify: jest.fn(),
      verifyDummy: jest.fn(),
    } as unknown as jest.Mocked<PasswordService>;

    mockSessionService = {
      revokeAllUserSessions: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<SessionService>;

    service = new StaffService(mockPrisma, mockPasswordService, mockSessionService);
  });

  describe('createStaff', () => {
    it('should allow MANAGER to provision a STAFF user and record an audit log', async () => {
      const mockTx = {
        user: {
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where.id === managerUser.id) return Promise.resolve(managerUser);
            if (where.email) return Promise.resolve(null);
            return Promise.resolve(null);
          }),
          create: jest.fn().mockResolvedValue({
            ...staffUser,
            email: 'newwaiter@aurel.restaurant',
          }),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx as unknown as Prisma.TransactionClient);
      });

      const result = await service.createStaff(managerUser, {
        email: 'newwaiter@aurel.restaurant',
        password: 'SecurePassword123!',
        fullName: 'New Waiter',
        role: UserRole.STAFF,
      });

      expect(result.email).toBe('newwaiter@aurel.restaurant');
      expect(result.role).toBe(UserRole.STAFF);
      expect(mockTx.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: managerUser.id,
          targetId: staffUser.id,
          action: AuditAction.STAFF_USER_CREATED,
          requestId: null,
          clientIp: null,
          metadata: {
            role: UserRole.STAFF,
            email: 'newwaiter@aurel.restaurant',
          },
        },
      });
    });

    it('should forbid MANAGER from provisioning another MANAGER (HTTP 403)', async () => {
      await expect(
        service.createStaff(managerUser, {
          email: 'anothermanager@aurel.restaurant',
          password: 'SecurePassword123!',
          fullName: 'Another Manager',
          role: UserRole.MANAGER,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should forbid MANAGER from provisioning an ADMIN (HTTP 403)', async () => {
      await expect(
        service.createStaff(managerUser, {
          email: 'adminattempt@aurel.restaurant',
          password: 'SecurePassword123!',
          fullName: 'Hacker Admin',
          role: UserRole.ADMIN,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should allow ADMIN to provision another ADMIN', async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        user: {
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where.id === adminUser.id) return Promise.resolve(adminUser);
            if (where.email) return Promise.resolve(null);
            return Promise.resolve(null);
          }),
          create: jest.fn().mockResolvedValue({
            ...adminUser,
            id: 'admin-uuid-2',
            email: 'admin2@aurel.restaurant',
          }),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx as unknown as Prisma.TransactionClient);
      });

      const result = await service.createStaff(adminUser, {
        email: 'admin2@aurel.restaurant',
        password: 'SecurePassword123!',
        fullName: 'Second Admin',
        role: UserRole.ADMIN,
      });

      expect(result.email).toBe('admin2@aurel.restaurant');
      expect(result.role).toBe(UserRole.ADMIN);
    });

    it('should reject provisioning with ConflictException (HTTP 409) if email is already taken', async () => {
      const mockTx = {
        user: {
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where.id === managerUser.id) return Promise.resolve(managerUser);
            if (where.email) return Promise.resolve(staffUser);
            return Promise.resolve(null);
          }),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx as unknown as Prisma.TransactionClient);
      });

      await expect(
        service.createStaff(managerUser, {
          email: staffUser.email,
          password: 'SecurePassword123!',
          fullName: 'Duplicate Staff',
          role: UserRole.STAFF,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should forbid deactivated actor from provisioning staff inside transaction (HTTP 403)', async () => {
      const mockTx = {
        user: {
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where.id === managerUser.id)
              return Promise.resolve({ ...managerUser, isActive: false });
            return Promise.resolve(null);
          }),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx as unknown as Prisma.TransactionClient);
      });

      await expect(
        service.createStaff(managerUser, {
          email: 'deactivatedactor@aurel.restaurant',
          password: 'SecurePassword123!',
          fullName: 'Deactivated Actor Attempt',
          role: UserRole.STAFF,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateStaffRole', () => {
    it('should forbid self-role modification (HTTP 403)', async () => {
      await expect(
        service.updateStaffRole(managerUser, managerUser.id, {
          role: UserRole.ADMIN,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should forbid MANAGER from assigning ADMIN or MANAGER role (HTTP 403)', async () => {
      await expect(
        service.updateStaffRole(managerUser, staffUser.id, {
          role: UserRole.ADMIN,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should forbid MANAGER from modifying an existing ADMIN account (HTTP 403)', async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([adminUser]),
        user: {
          findUnique: jest.fn().mockResolvedValue(managerUser),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx as unknown as Prisma.TransactionClient);
      });

      await expect(
        service.updateStaffRole(managerUser, adminUser.id, {
          role: UserRole.KITCHEN,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should forbid demoting the final active administrator in the system (HTTP 403)', async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([adminUser]),
        user: {
          findUnique: jest.fn().mockResolvedValue(adminUser),
          count: jest.fn().mockResolvedValue(1), // exactly 1 active admin!
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx as unknown as Prisma.TransactionClient);
      });

      await expect(
        service.updateStaffRole(adminUser, 'admin-uuid-target', {
          role: UserRole.MANAGER,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow ADMIN to update role, atomically revoke sessions, and record audit log', async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([staffUser]),
        user: {
          findUnique: jest.fn().mockResolvedValue(adminUser),
          count: jest.fn().mockResolvedValue(2),
          update: jest.fn().mockResolvedValue({
            ...staffUser,
            role: UserRole.KITCHEN,
          }),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx as unknown as Prisma.TransactionClient);
      });

      const result = await service.updateStaffRole(adminUser, staffUser.id, {
        role: UserRole.KITCHEN,
      });

      expect(result.role).toBe(UserRole.KITCHEN);
      // Verify session revocation called with targetId and transaction context
      expect(mockSessionService.revokeAllUserSessions).toHaveBeenCalledWith(staffUser.id, mockTx);
      expect(mockTx.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: adminUser.id,
          targetId: staffUser.id,
          action: AuditAction.USER_ROLE_UPDATED,
          requestId: null,
          clientIp: null,
          metadata: {
            oldRole: UserRole.STAFF,
            newRole: UserRole.KITCHEN,
          },
        },
      });
    });
  });

  describe('updateStaffStatus', () => {
    it('should forbid self-deactivation (HTTP 403)', async () => {
      await expect(
        service.updateStaffStatus(adminUser, adminUser.id, {
          isActive: false,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should forbid MANAGER from deactivating an ADMIN account (HTTP 403)', async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([adminUser]),
        user: {
          findUnique: jest.fn().mockResolvedValue(managerUser),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx as unknown as Prisma.TransactionClient);
      });

      await expect(
        service.updateStaffStatus(managerUser, adminUser.id, {
          isActive: false,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should forbid deactivating the last active administrator in the system (HTTP 403)', async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([adminUser]),
        user: {
          findUnique: jest.fn().mockResolvedValue(adminUser),
          count: jest.fn().mockResolvedValue(1), // only 1 admin!
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx as unknown as Prisma.TransactionClient);
      });

      await expect(
        service.updateStaffStatus(adminUser, 'another-admin-id', {
          isActive: false,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow deactivating staff user and atomically revoke their sessions', async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([staffUser]),
        user: {
          findUnique: jest.fn().mockResolvedValue(adminUser),
          update: jest.fn().mockResolvedValue({
            ...staffUser,
            isActive: false,
          }),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx as unknown as Prisma.TransactionClient);
      });

      const result = await service.updateStaffStatus(adminUser, staffUser.id, {
        isActive: false,
      });

      expect(result.isActive).toBe(false);
      expect(mockSessionService.revokeAllUserSessions).toHaveBeenCalledWith(staffUser.id, mockTx);
      expect(mockTx.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: adminUser.id,
          targetId: staffUser.id,
          action: AuditAction.USER_DEACTIVATED,
          requestId: null,
          clientIp: null,
          metadata: {
            oldStatus: true,
            newStatus: false,
          },
        },
      });
    });

    it('should allow reactivating a staff user without revoking or restoring sessions', async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([{ ...staffUser, isActive: false }]),
        user: {
          findUnique: jest.fn().mockResolvedValue(adminUser),
          update: jest.fn().mockResolvedValue({
            ...staffUser,
            isActive: true,
          }),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockTx as unknown as Prisma.TransactionClient);
      });

      const result = await service.updateStaffStatus(adminUser, staffUser.id, {
        isActive: true,
      });

      expect(result.isActive).toBe(true);
      expect(mockSessionService.revokeAllUserSessions).not.toHaveBeenCalled();
      expect(mockTx.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: adminUser.id,
          targetId: staffUser.id,
          action: AuditAction.USER_REACTIVATED,
          requestId: null,
          clientIp: null,
          metadata: {
            oldStatus: false,
            newStatus: true,
          },
        },
      });
    });
  });

  describe('getStaffById', () => {
    it('should throw NotFoundException (HTTP 404) if user does not exist', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getStaffById(adminUser, 'non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should forbid MANAGER from inspecting an ADMIN account (HTTP 403)', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(adminUser);

      await expect(service.getStaffById(managerUser, adminUser.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should permit MANAGER inspecting a STAFF account', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(staffUser);

      const result = await service.getStaffById(managerUser, staffUser.id);
      expect(result.id).toBe(staffUser.id);
      expect(result.role).toBe(UserRole.STAFF);
    });

    it('should permit STAFF inspecting their OWN account (Gate C)', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(staffUser);

      const result = await service.getStaffById(staffUser, staffUser.id);
      expect(result.id).toBe(staffUser.id);
      expect(result.role).toBe(UserRole.STAFF);
    });

    it('should forbid STAFF from inspecting ANOTHER account (Gate C least privilege)', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(adminUser);

      await expect(service.getStaffById(staffUser, adminUser.id)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getStaffList', () => {
    it('should forbid STAFF from listing staff directory (Gate C least privilege)', async () => {
      await expect(service.getStaffList(staffUser, {})).rejects.toThrow(ForbiddenException);
    });

    it('should allow MANAGER to list directory scoped to STAFF and KITCHEN', async () => {
      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([staffUser]);
      (mockPrisma.user.count as jest.Mock).mockResolvedValue(1);

      const result = await service.getStaffList(managerUser, {});
      expect(result.items.length).toBe(1);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: { in: [UserRole.STAFF, UserRole.KITCHEN] } },
        }),
      );
    });

    it('should allow ADMIN to list all staff accounts', async () => {
      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([
        adminUser,
        managerUser,
        staffUser,
      ]);
      (mockPrisma.user.count as jest.Mock).mockResolvedValue(3);

      const result = await service.getStaffList(adminUser, {});
      expect(result.items.length).toBe(3);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            role: {
              in: [UserRole.STAFF, UserRole.KITCHEN, UserRole.MANAGER, UserRole.ADMIN],
            },
          },
        }),
      );
    });
  });
});
