import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PlatformDatabaseService } from '../database/platform-database.service';
import {
  PLATFORM_SESSION_COOKIE,
  PlatformSessionGuard,
} from './platform-session.guard';

function requestContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('PlatformSessionGuard', () => {
  it('hydrates a principal from a valid opaque session', async () => {
    const request = { cookies: { [PLATFORM_SESSION_COOKIE]: 'raw-token' } };
    const findUnique = jest.fn().mockResolvedValue({
      id: 'session-1',
      adminId: 'admin-1',
      mfaVerified: false,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastSeenAt: new Date(),
      admin: {
        name: 'Platform Owner',
        email: 'owner@example.com',
        status: 'active',
        roles: [
          {
            role: {
              name: 'Platform owner',
              permissions: ['tenant.read', 'unknown.permission'],
            },
          },
        ],
      },
    });
    const database = {
      platformSession: { findUnique, update: jest.fn() },
    } as unknown as PlatformDatabaseService;
    const guard = new PlatformSessionGuard(database);

    await expect(guard.canActivate(requestContext(request))).resolves.toBe(
      true,
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tokenHash: createHash('sha256').update('raw-token').digest('hex'),
        },
      }),
    );
    expect(request).toHaveProperty('platformPrincipal.permissions', [
      'tenant.read',
    ]);
  });

  it('rejects a request without a session cookie', async () => {
    const guard = new PlatformSessionGuard({} as PlatformDatabaseService);

    await expect(
      guard.canActivate(requestContext({ cookies: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
