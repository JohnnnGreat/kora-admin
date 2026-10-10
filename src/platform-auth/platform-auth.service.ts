import {
  Injectable,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare } from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PlatformDatabaseService } from '../database/platform-database.service';
import {
  isPlatformPermission,
  type PlatformPermission,
} from '../platform-access/platform-permissions';
import type { PlatformPrincipal } from '../platform-access/platform-principal';

type RequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

type CreatedSession = {
  principal: PlatformPrincipal;
  rawToken: string;
  expiresAt: Date;
};

const DUMMY_PASSWORD_HASH =
  '$2b$12$aMRB41IcLVQIXED2/nyBiuFHwKZrENBibk98TbqFEOy/mjr1hANaa';

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly database: PlatformDatabaseService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async login(
    email: string,
    password: string,
    context: RequestContext,
  ): Promise<CreatedSession> {
    const normalizedEmail = email.trim().toLowerCase();
    const admin = await this.database.platformAdmin.findUnique({
      where: { email: normalizedEmail },
      include: {
        roles: { include: { role: true } },
        mfaMethods: {
          where: { verifiedAt: { not: null } },
          select: { id: true },
        },
      },
    });

    const passwordMatches = await compare(
      password,
      admin?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    const accepted = admin?.status === 'active' && passwordMatches;
    if (!accepted) {
      await this.audit.record({
        action: 'platform.auth.login',
        outcome: 'failure',
        ...context,
        metadata: { email: normalizedEmail },
      });
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (admin.mfaMethods.length > 0) {
      await this.audit.record({
        actorId: admin.id,
        action: 'platform.auth.login',
        outcome: 'failure',
        ...context,
        metadata: { reason: 'mfa_not_available' },
      });
      throw new NotImplementedException(
        'MFA verification is not available yet; access was not granted.',
      );
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(
      Date.now() +
        this.config.get<number>('SESSION_TTL_HOURS', 12) * 60 * 60 * 1_000,
    );
    const session = await this.database.$transaction(async (transaction) => {
      const created = await transaction.platformSession.create({
        data: {
          adminId: admin.id,
          tokenHash,
          expiresAt,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      await transaction.platformAdmin.update({
        where: { id: admin.id },
        data: { lastLoginAt: new Date() },
      });
      await transaction.platformAuditEvent.create({
        data: {
          actorId: admin.id,
          action: 'platform.auth.login',
          targetType: 'platform_session',
          targetId: created.id,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return created;
    });

    const permissions = this.permissionsFor(
      admin.roles.flatMap(({ role }) => role.permissions),
    );
    return {
      rawToken,
      expiresAt,
      principal: {
        adminId: admin.id,
        sessionId: session.id,
        name: admin.name,
        email: admin.email,
        roleNames: admin.roles.map(({ role }) => role.name),
        permissions,
        mfaVerified: false,
      },
    };
  }

  async logout(principal: PlatformPrincipal, context: RequestContext) {
    await this.database.$transaction(async (transaction) => {
      await transaction.platformSession.updateMany({
        where: {
          id: principal.sessionId,
          adminId: principal.adminId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await transaction.platformAuditEvent.create({
        data: {
          actorId: principal.adminId,
          action: 'platform.auth.logout',
          targetType: 'platform_session',
          targetId: principal.sessionId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
    });
  }

  private permissionsFor(values: string[]): PlatformPermission[] {
    return [...new Set(values.filter(isPlatformPermission))];
  }
}
