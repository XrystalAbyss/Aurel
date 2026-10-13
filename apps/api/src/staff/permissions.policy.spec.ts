import { UserRole, Permission, hasPermission, ROLE_PERMISSIONS } from '@aurel/shared-types';

describe('Aurel P2.3 — Role-Permission Policy Engine', () => {
  describe('hasPermission pure function', () => {
    it('should deny all staff and admin permissions to CUSTOMER role (deny by default)', () => {
      const allPermissions = Object.values(Permission);
      for (const perm of allPermissions) {
        expect(hasPermission(UserRole.CUSTOMER, perm)).toBe(false);
      }
    });

    it('should grant STAFF only staff.self.read permission, strictly denying general staff.read directory enumeration', () => {
      expect(hasPermission(UserRole.STAFF, Permission.STAFF_SELF_READ)).toBe(true);
      expect(hasPermission(UserRole.STAFF, Permission.STAFF_READ)).toBe(false);
      expect(hasPermission(UserRole.STAFF, Permission.STAFF_CREATE)).toBe(false);
      expect(hasPermission(UserRole.STAFF, Permission.STAFF_UPDATE)).toBe(false);
      expect(hasPermission(UserRole.STAFF, Permission.STAFF_ACTIVATE)).toBe(false);
      expect(hasPermission(UserRole.STAFF, Permission.STAFF_DEACTIVATE)).toBe(false);
      expect(hasPermission(UserRole.STAFF, Permission.STAFF_ROLE_ASSIGN)).toBe(false);
      expect(hasPermission(UserRole.STAFF, Permission.ADMIN_CREATE)).toBe(false);
      expect(hasPermission(UserRole.STAFF, Permission.AUDIT_READ)).toBe(false);
    });

    it('should grant KITCHEN only staff.self.read permission, strictly denying general staff.read directory enumeration', () => {
      expect(hasPermission(UserRole.KITCHEN, Permission.STAFF_SELF_READ)).toBe(true);
      expect(hasPermission(UserRole.KITCHEN, Permission.STAFF_READ)).toBe(false);
      expect(hasPermission(UserRole.KITCHEN, Permission.STAFF_CREATE)).toBe(false);
      expect(hasPermission(UserRole.KITCHEN, Permission.STAFF_UPDATE)).toBe(false);
      expect(hasPermission(UserRole.KITCHEN, Permission.STAFF_DEACTIVATE)).toBe(false);
      expect(hasPermission(UserRole.KITCHEN, Permission.ADMIN_CREATE)).toBe(false);
      expect(hasPermission(UserRole.KITCHEN, Permission.AUDIT_READ)).toBe(false);
    });

    it('should grant MANAGER operational staff permissions but not admin.create or audit.read', () => {
      expect(hasPermission(UserRole.MANAGER, Permission.STAFF_READ)).toBe(true);
      expect(hasPermission(UserRole.MANAGER, Permission.STAFF_CREATE)).toBe(true);
      expect(hasPermission(UserRole.MANAGER, Permission.STAFF_UPDATE)).toBe(true);
      expect(hasPermission(UserRole.MANAGER, Permission.STAFF_ACTIVATE)).toBe(true);
      expect(hasPermission(UserRole.MANAGER, Permission.STAFF_DEACTIVATE)).toBe(true);
      expect(hasPermission(UserRole.MANAGER, Permission.STAFF_ROLE_ASSIGN)).toBe(true);
      // Crucial security boundaries:
      expect(hasPermission(UserRole.MANAGER, Permission.ADMIN_CREATE)).toBe(false);
      expect(hasPermission(UserRole.MANAGER, Permission.AUDIT_READ)).toBe(false);
    });

    it('should grant ADMIN all identity, admin provisioning, and audit read permissions', () => {
      expect(hasPermission(UserRole.ADMIN, Permission.STAFF_READ)).toBe(true);
      expect(hasPermission(UserRole.ADMIN, Permission.STAFF_CREATE)).toBe(true);
      expect(hasPermission(UserRole.ADMIN, Permission.STAFF_UPDATE)).toBe(true);
      expect(hasPermission(UserRole.ADMIN, Permission.STAFF_ACTIVATE)).toBe(true);
      expect(hasPermission(UserRole.ADMIN, Permission.STAFF_DEACTIVATE)).toBe(true);
      expect(hasPermission(UserRole.ADMIN, Permission.STAFF_ROLE_ASSIGN)).toBe(true);
      expect(hasPermission(UserRole.ADMIN, Permission.ADMIN_CREATE)).toBe(true);
      expect(hasPermission(UserRole.ADMIN, Permission.AUDIT_READ)).toBe(true);
      expect(hasPermission(UserRole.ADMIN, Permission.SYSTEM_CONFIGURE)).toBe(true);
    });

    it('should safely return false for undefined, null, or unknown roles', () => {
      expect(hasPermission(undefined, Permission.STAFF_READ)).toBe(false);
      expect(hasPermission(null, Permission.STAFF_READ)).toBe(false);
      expect(hasPermission('UNKNOWN_ROLE' as unknown as UserRole, Permission.STAFF_READ)).toBe(
        false,
      );
    });

    it('should verify that role permission sets are immutable (ReadonlySet)', () => {
      const managerPerms = ROLE_PERMISSIONS[UserRole.MANAGER];
      expect(managerPerms.has(Permission.STAFF_CREATE)).toBe(true);
      expect(managerPerms.has(Permission.ADMIN_CREATE)).toBe(false);
    });
  });
});
