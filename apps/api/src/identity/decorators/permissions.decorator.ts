import { SetMetadata, CustomDecorator } from '@nestjs/common';
import { Permission } from '@aurel/shared-types';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator to require one or more explicit permissions on a route handler or controller.
 * Denies by default if omitted when evaluated by PermissionsGuard.
 */
export const RequirePermissions = (...permissions: Permission[]): CustomDecorator<string> =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const Permissions = RequirePermissions;
