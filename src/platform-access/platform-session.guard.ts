import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PlatformDatabaseService } from '../database/platform-database.service';
import {
  isPlatformPermission,
  type PlatformPermission,
} from './platform-permissions';
import type { PlatformRequest } from './platform-request';

export const PLATFORM_SESSION_COOKIE = 'kora_admin_session';

function uniquePermissions(values: string[]): PlatformPermission[] {
  return [...new Set(values.filter(isPlatformPermission))];
}

@Injectable()
export class PlatformSessionGuard implements CanActivate {
  constructor(private readonly database: PlatformDatabaseService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const token = request.cookies?.[PLATFORM_SESSION_COOKIE] as
      string | undefined;
    if (!token) throw new UnauthorizedException('Not authenticated.');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = await this.database.platformSession.findUnique({
      where: { tokenHash },
      include: {
        admin: {
          include: { roles: { include: { role: true } } },
        },
      },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.admin.status !== 'active'
    ) {
      throw new UnauthorizedException('Session is invalid or expired.');
    }

    const roles = session.admin.roles.map(({ role }) => role);
    request.platformPrincipal = {
      adminId: session.adminId,
      sessionId: session.id,
      name: session.admin.name,
      email: session.admin.email,
      roleNames: roles.map((role) => role.name),
      permissions: uniquePermissions(roles.flatMap((role) => role.permissions)),
      mfaVerified: session.mfaVerified,
    };

    if (now.getTime() - session.lastSeenAt.getTime() >= 5 * 60 * 1_000) {
      void this.database.platformSession
        .update({ where: { id: session.id }, data: { lastSeenAt: now } })
        .catch(() => undefined);
    }
    return true;
  }
}
