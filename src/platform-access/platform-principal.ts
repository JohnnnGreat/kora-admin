import type { PlatformPermission } from './platform-permissions';

export type PlatformPrincipal = {
  adminId: string;
  sessionId: string;
  name: string;
  email: string;
  roleNames: string[];
  permissions: PlatformPermission[];
  mfaVerified: boolean;
};
