import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformPermissionsGuard } from './platform-permissions.guard';

function contextWithPermissions(permissions: string[]): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({ platformPrincipal: { permissions } }),
    }),
  } as unknown as ExecutionContext;
}

describe('PlatformPermissionsGuard', () => {
  it('allows an administrator with every required permission', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['tenant.read']),
    } as unknown as Reflector;
    const guard = new PlatformPermissionsGuard(reflector);

    expect(guard.canActivate(contextWithPermissions(['tenant.read']))).toBe(
      true,
    );
  });

  it('rejects an administrator missing a required permission', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['tenant.manage']),
    } as unknown as Reflector;
    const guard = new PlatformPermissionsGuard(reflector);

    expect(() =>
      guard.canActivate(contextWithPermissions(['tenant.read'])),
    ).toThrow(ForbiddenException);
  });
});
