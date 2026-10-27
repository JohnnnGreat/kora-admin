import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { PlatformDatabaseService } from '../database/platform-database.service';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { CoreApiClient } from './core-api.client';

// A part of the page that could not be filled in. The pages are about things
// going wrong, so a core service that is down must show up as "the core is
// unreachable" in the right place, not turn the whole page into an error.
export type Section<T> =
  { available: true; data: T } | { available: false; reason: string };

export type OverallStatus = 'healthy' | 'degraded' | 'down';

const round1 = (value: number) => Math.round(value * 10) / 10;

export async function section<T>(work: () => Promise<T>): Promise<Section<T>> {
  try {
    return { available: true, data: await work() };
  } catch (error) {
    const reason =
      error instanceof Error && error.message
        ? error.message
        : 'This could not be read.';
    return { available: false, reason };
  }
}

export interface CoreHealth {
  status: OverallStatus;
  reasons: { severity: 'warning' | 'critical'; message: string }[];
}

/** The page's headline: the core's own verdict, or "down" when it cannot be asked. */
export function overallStatus(
  core: Section<CoreHealth>,
  adminPlatformDatabaseUp: boolean,
): { status: OverallStatus; reasons: string[] } {
  const reasons: string[] = [];
  let status: OverallStatus = 'healthy';
  if (!core.available) {
    status = 'down';
    reasons.push(`The core Kora service cannot be reached: ${core.reason}`);
  } else {
    status = core.data.status;
    reasons.push(...core.data.reasons.map((reason) => reason.message));
  }
  if (!adminPlatformDatabaseUp) {
    // The admin app's own database being down is a fault in the admin app, but
    // does not stop the platform serving customers.
    if (status === 'healthy') status = 'degraded';
    reasons.push("The admin app's own database is not reachable.");
  }
  return { status, reasons };
}

@Injectable()
export class OperationsService {
  private readonly startedAt = new Date();

  constructor(
    private readonly core: CoreApiClient,
    private readonly platform: PlatformDatabaseService,
    private readonly tenant: TenantDatabaseService,
  ) {}

  private async adminApi() {
    const startedAt = process.hrtime.bigint();
    let platformUp = true;
    try {
      await this.platform.$queryRaw`SELECT 1`;
    } catch {
      platformUp = false;
    }
    const latencyMs = round1(Number(process.hrtime.bigint() - startedAt) / 1e6);
    let tenantDatabase: { configured: boolean; connected: boolean };
    try {
      tenantDatabase = await this.tenant.healthCheck();
    } catch {
      tenantDatabase = {
        configured: this.tenant.isConfigured(),
        connected: false,
      };
    }
    const memory = process.memoryUsage();
    return {
      platformDatabase: {
        connected: platformUp,
        latencyMs: platformUp ? latencyMs : null,
      },
      tenantDatabase,
      coreConfigured: this.core.isConfigured(),
      uptimeSeconds: Math.round(process.uptime()),
      rssMb: Math.round(memory.rss / 1024 ** 2),
      heapUsedMb: Math.round(memory.heapUsed / 1024 ** 2),
      nodeVersion: process.version,
    };
  }

  async monitoring(windowMinutes?: number) {
    const [admin, health, metrics] = await Promise.all([
      this.adminApi(),
      section(() =>
        this.core.get<CoreHealth & Record<string, unknown>>(
          '/platform/operations/health',
        ),
      ),
      section(() =>
        this.core.get<Record<string, unknown>>(
          `/platform/operations/metrics${windowMinutes ? `?minutes=${windowMinutes}` : ''}`,
        ),
      ),
    ]);
    const verdict = overallStatus(health, admin.platformDatabase.connected);
    return {
      checkedAt: new Date().toISOString(),
      status: verdict.status,
      reasons: verdict.reasons,
      core: health,
      requests: metrics,
      adminApi: admin,
    };
  }

  queues() {
    return section(() => this.core.get('/platform/operations/queues'));
  }

  storage(refresh: boolean) {
    // A scan of the uploads folder can take most of half a minute.
    return section(() =>
      this.core.get(
        `/platform/operations/storage${refresh ? '?refresh=true' : ''}`,
        45_000,
      ),
    );
  }

  backups() {
    return section(() => this.core.get('/platform/operations/backups'));
  }

  async releases() {
    const [core, version] = await Promise.all([
      section(() => this.core.get('/platform/operations/releases')),
      this.packageVersion(),
    ]);
    const sha = (process.env.GIT_SHA ?? '').trim();
    return {
      checkedAt: new Date().toISOString(),
      core,
      // The admin API is a second service with its own deploys; it knows only
      // what it is running now, not a history.
      adminApi: {
        version,
        gitSha: sha || null,
        shortSha: sha ? sha.slice(0, 7) : null,
        startedAt: this.startedAt.toISOString(),
        nodeVersion: process.version,
      },
    };
  }

  private async packageVersion(): Promise<string | null> {
    try {
      const text = await readFile(join(process.cwd(), 'package.json'), 'utf8');
      return (JSON.parse(text) as { version?: string }).version ?? null;
    } catch {
      return null;
    }
  }

  retryReportJob(id: string) {
    return this.core.post<{ retried: number }>(
      `/platform/operations/queues/reports/jobs/${encodeURIComponent(id)}/retry`,
    );
  }

  retryAllReportJobs() {
    return this.core.post<{ retried: number }>(
      '/platform/operations/queues/reports/retry-failed',
    );
  }

  requestBackup(requestedBy: string, reason?: string) {
    return this.core.post<{ id: string; status: string; requestedAt: string }>(
      '/platform/operations/backups/request',
      { requestedBy, reason },
    );
  }

  errors(query: Record<string, string | undefined>) {
    const params = new URLSearchParams(
      Object.entries(query).filter(([, value]) => value !== undefined) as [
        string,
        string,
      ][],
    ).toString();
    return this.core.get(
      `/platform/operations/errors${params ? `?${params}` : ''}`,
    );
  }

  resolveError(id: string, resolvedBy: string, note?: string) {
    return this.core.post(
      `/platform/operations/errors/${encodeURIComponent(id)}/resolve`,
      { resolvedBy, note },
    );
  }

  unresolveError(id: string) {
    return this.core.post(
      `/platform/operations/errors/${encodeURIComponent(id)}/unresolve`,
    );
  }
}
