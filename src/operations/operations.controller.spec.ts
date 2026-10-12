import { PLATFORM_PERMISSIONS_KEY } from '../platform-access/require-platform-permissions.decorator';
import type { PlatformPrincipal } from '../platform-access/platform-principal';
import type { AuditService } from '../audit/audit.service';
import { OperationsController } from './operations.controller';
import type { OperationsService } from './operations.service';

const permissionsOf = (handler: keyof OperationsController) =>
  Reflect.getMetadata(
    PLATFORM_PERMISSIONS_KEY,
    Object.getOwnPropertyDescriptor(OperationsController.prototype, handler)
      ?.value as object,
  ) as string[] | undefined;

describe('OperationsController permissions', () => {
  it('lets the read pages through on operations.read alone', () => {
    expect(
      Reflect.getMetadata(PLATFORM_PERMISSIONS_KEY, OperationsController),
    ).toEqual(['operations.read']);
    for (const handler of [
      'monitoring',
      'queues',
      'storage',
      'releases',
    ] as const) {
      expect(permissionsOf(handler)).toBeUndefined();
    }
  });

  it('needs operations.manage to see the backups page', () => {
    expect(permissionsOf('backups')).toEqual(['operations.manage']);
  });

  it('needs operations.manage for everything that changes something', () => {
    for (const handler of ['retryJob', 'retryAll', 'requestBackup'] as const) {
      expect(permissionsOf(handler)).toEqual([
        'operations.read',
        'operations.manage',
      ]);
    }
  });
});

describe('OperationsController', () => {
  const principal = {
    adminId: 'admin-1',
    name: 'Ada',
    email: 'ada@example.com',
  } as unknown as PlatformPrincipal;
  const request = {
    ip: '10.0.0.1',
    headers: { 'user-agent': 'jest' },
  } as never;

  const build = () => {
    const operations = {
      monitoring: jest.fn().mockResolvedValue({}),
      retryReportJob: jest.fn().mockResolvedValue({ retried: 1 }),
      retryAllReportJobs: jest.fn().mockResolvedValue({ retried: 3 }),
      requestBackup: jest
        .fn()
        .mockResolvedValue({ id: 'req-1', status: 'pending' }),
      storage: jest.fn().mockResolvedValue({}),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new OperationsController(
      operations as unknown as OperationsService,
      audit as unknown as AuditService,
    );
    return { controller, operations, audit };
  };

  it('ignores a window that is not a positive whole number of minutes', async () => {
    const { controller, operations } = build();

    await controller.monitoring('abc');
    await controller.monitoring('-5');
    await controller.monitoring('2.5');
    await controller.monitoring('30');

    expect(
      (operations.monitoring.mock.calls as unknown[][]).map((call) => call[0]),
    ).toEqual([undefined, undefined, undefined, 30]);
  });

  it('rescans storage only for refresh=true', async () => {
    const { controller, operations } = build();

    await controller.storage('true');
    await controller.storage('yes');
    await controller.storage();

    expect(
      (operations.storage.mock.calls as unknown[][]).map((call) => call[0]),
    ).toEqual([true, false, false]);
  });

  it('audits a single job retry', async () => {
    const { controller, audit } = build();

    await expect(
      controller.retryJob('job-9', principal, request),
    ).resolves.toEqual({
      retried: 1,
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'operations.queue_job_retried',
        targetType: 'operations',
        targetId: 'job-9',
        ipAddress: '10.0.0.1',
        metadata: { queue: 'reports' },
      }),
    );
  });

  it('audits retry-all with how many jobs it retried', async () => {
    const { controller, audit } = build();

    await controller.retryAll(principal, request);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'operations.queue_retry_all',
        metadata: { queue: 'reports', retried: 3 },
      }),
    );
  });

  it('records who asked for a backup, and why', async () => {
    const { controller, operations, audit } = build();

    await controller.requestBackup(
      { reason: 'before upgrade' },
      principal,
      request,
    );

    expect(operations.requestBackup).toHaveBeenCalledWith(
      'Ada <ada@example.com>',
      'before upgrade',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'operations.backup_requested',
        targetId: 'req-1',
        metadata: { reason: 'before upgrade' },
      }),
    );
  });

  it('records a null reason when none was given', async () => {
    const { controller, audit } = build();

    await controller.requestBackup({}, principal, request);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { reason: null } }),
    );
  });
});
