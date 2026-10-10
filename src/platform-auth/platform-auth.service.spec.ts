import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { PlatformDatabaseService } from '../database/platform-database.service';
import { PlatformAuthService } from './platform-auth.service';

describe('PlatformAuthService', () => {
  it('creates an opaque session for a valid platform administrator', async () => {
    const passwordHash = await hash('correct-password', 4);
    const admin = {
      id: 'admin-1',
      name: 'Platform Owner',
      email: 'owner@example.com',
      passwordHash,
      status: 'active',
      mfaMethods: [],
      roles: [
        {
          role: {
            name: 'Platform owner',
            permissions: ['tenant.read', 'invalid.permission'],
          },
        },
      ],
    };
    let capturedCreateInput: { data: { tokenHash: string } } | undefined;
    const transaction = {
      platformSession: {
        create: jest.fn((input: unknown) => {
          capturedCreateInput = input as { data: { tokenHash: string } };
          return Promise.resolve({ id: 'session-1' });
        }),
      },
      platformAdmin: { update: jest.fn().mockResolvedValue(admin) },
      platformAuditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const database = {
      platformAdmin: { findUnique: jest.fn().mockResolvedValue(admin) },
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          Promise.resolve(callback(transaction)),
      ),
    } as unknown as PlatformDatabaseService;
    const audit = {
      record: jest.fn().mockResolvedValue({}),
    } as unknown as AuditService;
    const config = {
      get: jest.fn((_key: string, fallback: unknown) => fallback),
    } as unknown as ConfigService;
    const service = new PlatformAuthService(database, audit, config);

    const result = await service.login(
      ' OWNER@example.com ',
      'correct-password',
      { ipAddress: '127.0.0.1' },
    );

    expect(result.rawToken).toHaveLength(43);
    expect(result.principal).toMatchObject({
      adminId: 'admin-1',
      sessionId: 'session-1',
      email: 'owner@example.com',
      permissions: ['tenant.read'],
      mfaVerified: false,
    });
    expect(transaction.platformSession.create.mock.calls).toHaveLength(1);
    expect(capturedCreateInput?.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('records and rejects an invalid login without revealing the account', async () => {
    const database = {
      platformAdmin: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PlatformDatabaseService;
    const auditRecord = jest.fn().mockResolvedValue({});
    const audit = { record: auditRecord } as unknown as AuditService;
    const service = new PlatformAuthService(database, audit, {
      get: jest.fn(),
    } as unknown as ConfigService);

    await expect(
      service.login('missing@example.com', 'wrong-password', {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform.auth.login',
        outcome: 'failure',
      }),
    );
  });
});
