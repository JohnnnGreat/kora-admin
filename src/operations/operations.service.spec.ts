import {
  section,
  overallStatus,
  OperationsService,
} from './operations.service';
import type { CoreApiClient } from './core-api.client';
import type { PlatformDatabaseService } from '../database/platform-database.service';
import type { TenantDatabaseService } from '../database/tenant-database.service';

describe('section', () => {
  it('wraps a result', async () => {
    await expect(section(() => Promise.resolve(5))).resolves.toEqual({
      available: true,
      data: 5,
    });
  });

  it('turns a failure into a reason instead of throwing', async () => {
    await expect(
      section(() => Promise.reject(new Error('core is down'))),
    ).resolves.toEqual({ available: false, reason: 'core is down' });
  });

  it('has a fallback reason when the error carries no message', async () => {
    const result = await section(() => Promise.reject(new Error('')));
    expect(result).toEqual({
      available: false,
      reason: 'This could not be read.',
    });
  });
});

describe('overallStatus', () => {
  const healthy = {
    available: true as const,
    data: { status: 'healthy' as const, reasons: [] },
  };

  it('is healthy when the core and the admin database are both fine', () => {
    expect(overallStatus(healthy, true)).toEqual({
      status: 'healthy',
      reasons: [],
    });
  });

  it("uses the core's own verdict and reasons", () => {
    const core = {
      available: true as const,
      data: {
        status: 'degraded' as const,
        reasons: [{ severity: 'warning' as const, message: 'Queue backed up' }],
      },
    };
    expect(overallStatus(core, true)).toEqual({
      status: 'degraded',
      reasons: ['Queue backed up'],
    });
  });

  it('is down when the core cannot be reached', () => {
    const result = overallStatus({ available: false, reason: 'timeout' }, true);
    expect(result.status).toBe('down');
    expect(result.reasons[0]).toContain('timeout');
  });

  it("degrades a healthy platform when only the admin app's own database is down", () => {
    const result = overallStatus(healthy, false);
    expect(result.status).toBe('degraded');
    expect(result.reasons).toHaveLength(1);
  });

  it('does not soften a core that is already down', () => {
    const result = overallStatus({ available: false, reason: 'x' }, false);
    expect(result.status).toBe('down');
  });
});

describe('OperationsService', () => {
  const build = (overrides: { platformUp?: boolean } = {}) => {
    const core = {
      get: jest.fn(),
      post: jest.fn(),
      isConfigured: jest.fn(() => true),
    };
    const platform = {
      $queryRaw: jest.fn(() =>
        overrides.platformUp === false
          ? Promise.reject(new Error('down'))
          : Promise.resolve([{ '?column?': 1 }]),
      ),
    };
    const tenant = {
      healthCheck: jest.fn().mockResolvedValue({
        configured: true,
        connected: true,
      }),
      isConfigured: jest.fn(() => true),
    };
    const service = new OperationsService(
      core as unknown as CoreApiClient,
      platform as unknown as PlatformDatabaseService,
      tenant as unknown as TenantDatabaseService,
    );
    return { service, core, platform, tenant };
  };

  it('puts the core health, request metrics and the admin api on one page', async () => {
    const { service, core } = build();
    core.get.mockImplementation((path: string) =>
      path.includes('/health')
        ? Promise.resolve({ status: 'healthy', reasons: [] })
        : Promise.resolve({ requestsPerMinute: 4 }),
    );

    const page = await service.monitoring(30);

    expect(page.status).toBe('healthy');
    expect(page.core).toMatchObject({ available: true });
    expect(page.requests).toEqual({
      available: true,
      data: { requestsPerMinute: 4 },
    });
    expect(page.adminApi.platformDatabase.connected).toBe(true);
    expect(core.get).toHaveBeenCalledWith(
      '/platform/operations/metrics?minutes=30',
    );
  });

  it('still renders when the core is unreachable, and says so', async () => {
    const { service, core } = build();
    core.get.mockRejectedValue(new Error('refused'));

    const page = await service.monitoring();

    expect(page.status).toBe('down');
    expect(page.core).toEqual({ available: false, reason: 'refused' });
    expect(page.requests).toEqual({ available: false, reason: 'refused' });
    expect(core.get).toHaveBeenCalledWith('/platform/operations/metrics');
  });

  it('marks its own database as down without failing the page', async () => {
    const { service, core } = build({ platformUp: false });
    core.get.mockResolvedValue({ status: 'healthy', reasons: [] });

    const page = await service.monitoring();

    expect(page.adminApi.platformDatabase).toEqual({
      connected: false,
      latencyMs: null,
    });
    expect(page.status).toBe('degraded');
  });

  it('asks the core for a fresh storage scan only when told to', async () => {
    const { service, core } = build();
    core.get.mockResolvedValue({});

    await service.storage(false);
    await service.storage(true);

    expect(core.get).toHaveBeenNthCalledWith(
      1,
      '/platform/operations/storage',
      45_000,
    );
    expect(core.get).toHaveBeenNthCalledWith(
      2,
      '/platform/operations/storage?refresh=true',
      45_000,
    );
  });

  it('reports the admin api release next to the core release', async () => {
    const { service, core } = build();
    core.get.mockResolvedValue({ version: '1.0.0' });
    process.env.GIT_SHA = 'abcdef1234567890';

    const releases = await service.releases();

    delete process.env.GIT_SHA;
    expect(releases.core).toEqual({
      available: true,
      data: { version: '1.0.0' },
    });
    expect(releases.adminApi.gitSha).toBe('abcdef1234567890');
    expect(releases.adminApi.shortSha).toBe('abcdef1');
  });

  it('has no sha when the deploy did not provide one', async () => {
    const { service, core } = build();
    core.get.mockResolvedValue({});
    delete process.env.GIT_SHA;

    const releases = await service.releases();

    expect(releases.adminApi.gitSha).toBeNull();
    expect(releases.adminApi.shortSha).toBeNull();
  });

  it('encodes a job id when retrying, and posts who asked for a backup', async () => {
    const { service, core } = build();
    core.post.mockResolvedValue({ retried: 1 });

    await service.retryReportJob('a/b c');
    await service.retryAllReportJobs();
    await service.requestBackup('Ada <ada@x.com>', 'before upgrade');

    expect(core.post).toHaveBeenNthCalledWith(
      1,
      '/platform/operations/queues/reports/jobs/a%2Fb%20c/retry',
    );
    expect(core.post).toHaveBeenNthCalledWith(
      2,
      '/platform/operations/queues/reports/retry-failed',
    );
    expect(core.post).toHaveBeenNthCalledWith(
      3,
      '/platform/operations/backups/request',
      { requestedBy: 'Ada <ada@x.com>', reason: 'before upgrade' },
    );
  });
});
