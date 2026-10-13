import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ErrorCode, Permission, UserRole, hasPermission } from '@aurel/shared-types';
import { User } from '@prisma/client';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Deny-by-default: If PermissionsGuard is attached but no permissions are declared, reject access
    if (!requiredPermissions || requiredPermissions.length === 0) {
      throw new ForbiddenException({
        message: 'Access forbidden: no permission metadata configured for this protected route.',
        code: ErrorCode.FORBIDDEN,
        error: 'Forbidden',
      });
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as { user?: User }).user;

    if (!user || !user.role) {
      throw new ForbiddenException({
        message: 'Access forbidden: authenticated user context is missing or invalid.',
        code: ErrorCode.FORBIDDEN,
        error: 'Forbidden',
      });
    }

    if (!user.isActive) {
      throw new ForbiddenException({
        message: 'Access forbidden: user account is deactivated.',
        code: ErrorCode.FORBIDDEN,
        error: 'Forbidden',
      });
    }

    const userRole = user.role as UserRole;

    for (const permission of requiredPermissions) {
      if (!hasPermission(userRole, permission)) {
        throw new ForbiddenException({
          message: `Access forbidden: account lacks required permission '${permission}'.`,
          code: ErrorCode.FORBIDDEN,
          error: 'Forbidden',
        });
      }
    }

    return true;
  }
}
