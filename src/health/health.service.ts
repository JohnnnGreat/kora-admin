import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PlatformDatabaseService } from '../database/platform-database.service';
import { TenantDatabaseService } from '../database/tenant-database.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly platformDatabase: PlatformDatabaseService,
    private readonly tenantDatabase: TenantDatabaseService,
  ) {}

  live() {
    return { status: 'ok', service: 'kora-admin-api' };
  }

  async ready() {
    try {
      await this.platformDatabase.$queryRaw`SELECT 1`;
      const tenant = await this.tenantDatabase.healthCheck();
      return {
        status: 'ready',
        databases: {
          platform: { configured: true, connected: true },
          tenant,
        },
      };
    } catch {
      throw new ServiceUnavailableException('Service is not ready.');
    }
  }
}
