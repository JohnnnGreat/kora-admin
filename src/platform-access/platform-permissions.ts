export const PLATFORM_PERMISSIONS = [
  'platform.dashboard.read',
  'tenant.read',
  'tenant.manage',
  'tenant.impersonate',
  'billing.read',
  'billing.manage',
  'security.read',
  'security.respond',
  'operations.read',
  'operations.manage',
  'platform.configure',
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export function isPlatformPermission(
  value: string,
): value is PlatformPermission {
  return PLATFORM_PERMISSIONS.includes(value as PlatformPermission);
}
