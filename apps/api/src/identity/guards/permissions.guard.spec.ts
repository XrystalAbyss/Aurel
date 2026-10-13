import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { Permission, UserRole, ErrorCode } from '@aurel/shared-types';
import { User } from '@prisma/client';

describe('PermissionsGuard Unit Tests', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  const createMockContext = (
    user?: Partial<User> | null,
    _handlerPermissions?: Permission[],
  ): ExecutionContext => {
    const mockRequest = { user };
    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  it('should deny by default (HTTP 403) when no permission metadata is defined on the route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const context = createMockContext({
      id: 'user-1',
      role: UserRole.ADMIN,
      isActive: true,
    } as User);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    try {
      guard.canActivate(context);
    } catch (err) {
      const resp = (err as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(resp.code).toBe(ErrorCode.FORBIDDEN);
      expect(resp.message).toContain('no permission metadata configured');
    }
  });

  it('should deny (HTTP 403) when user context is missing from request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.STAFF_READ]);

    const context = createMockContext(null);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    try {
      guard.canActivate(context);
    } catch (err) {
      const resp = (err as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(resp.code).toBe(ErrorCode.FORBIDDEN);
      expect(resp.message).toContain('authenticated user context is missing');
    }
  });

  it('should deny (HTTP 403) when user account is deactivated', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.STAFF_READ]);

    const context = createMockContext({
      id: 'user-1',
      role: UserRole.STAFF,
      isActive: false,
    } as User);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    try {
      guard.canActivate(context);
    } catch (err) {
      const resp = (err as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(resp.code).toBe(ErrorCode.FORBIDDEN);
      expect(resp.message).toContain('user account is deactivated');
    }
  });

  it('should deny (HTTP 403) when user role lacks required permission', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.STAFF_CREATE]);

    // STAFF role does NOT have STAFF_CREATE
    const context = createMockContext({
      id: 'user-1',
      role: UserRole.STAFF,
      isActive: true,
    } as User);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    try {
      guard.canActivate(context);
    } catch (err) {
      const resp = (err as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(resp.code).toBe(ErrorCode.FORBIDDEN);
      expect(resp.message).toContain("lacks required permission 'staff.create'");
    }
  });

  it('should deny (HTTP 403) when CUSTOMER attempts to access staff endpoint', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.STAFF_READ]);

    const context = createMockContext({
      id: 'customer-1',
      role: UserRole.CUSTOMER,
      isActive: true,
    } as User);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny (HTTP 403) when MANAGER attempts to access admin-only endpoint', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.ADMIN_CREATE]);

    const context = createMockContext({
      id: 'manager-1',
      role: UserRole.MANAGER,
      isActive: true,
    } as User);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should permit access (returns true) when user possesses all required permissions', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Permission.STAFF_READ, Permission.STAFF_CREATE]);

    const context = createMockContext({
      id: 'manager-1',
      role: UserRole.MANAGER,
      isActive: true,
    } as User);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should permit ADMIN access for any granted permission', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Permission.ADMIN_CREATE, Permission.AUDIT_READ]);

    const context = createMockContext({
      id: 'admin-1',
      role: UserRole.ADMIN,
      isActive: true,
    } as User);

    expect(guard.canActivate(context)).toBe(true);
  });
});
