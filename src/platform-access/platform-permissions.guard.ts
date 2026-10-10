import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformPermission } from './platform-permissions';
import type { PlatformRequest } from './platform-request';
import { PLATFORM_PERMISSIONS_KEY } from './require-platform-permissions.decorator';

@Injectable()
export class PlatformPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<PlatformPermission[]>(
      PLATFORM_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const principal = context
      .switchToHttp()
      .getRequest<PlatformRequest>().platformPrincipal;
    if (!principal) throw new ForbiddenException('No platform identity.');
    if (
      !required.every((permission) =>
        principal.permissions.includes(permission),
      )
    ) {
      throw new ForbiddenException('Insufficient platform permissions.');
    }
    return true;
  }
}
