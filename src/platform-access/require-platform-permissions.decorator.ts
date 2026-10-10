import { SetMetadata } from '@nestjs/common';
import type { PlatformPermission } from './platform-permissions';

export const PLATFORM_PERMISSIONS_KEY = 'platform:permissions';

export const RequirePlatformPermissions = (
  ...permissions: PlatformPermission[]
) => SetMetadata(PLATFORM_PERMISSIONS_KEY, permissions);
