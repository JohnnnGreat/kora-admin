import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type QueryResultRow } from 'pg';

@Injectable()
export class TenantDatabaseService implements OnModuleDestroy {
  private readonly pool?: Pool;

  constructor(config: ConfigService) {
    const connectionString = config.get<string>('TENANT_DATABASE_URL');
    if (!connectionString) return;

    this.pool = new Pool({
      connectionString,
      max: config.get<number>('TENANT_DB_POOL_MAX', 5),
      connectionTimeoutMillis: config.get<number>(
        'TENANT_DB_POOL_CONNECT_TIMEOUT_MS',
        5_000,
      ),
      idleTimeoutMillis: config.get<number>(
        'TENANT_DB_POOL_IDLE_TIMEOUT_MS',
        30_000,
      ),
      application_name: 'kora-admin-api-tenant-reader',
    });
  }

  isConfigured() {
    return Boolean(this.pool);
  }

  async read<T extends QueryResultRow>(text: string, values: unknown[] = []) {
    if (!/^\s*(SELECT|WITH)\b/i.test(text)) {
      throw new Error('TenantDatabaseService only accepts read queries.');
    }
    if (!this.pool) {
      throw new ServiceUnavailableException(
        'Tenant database access is not configured.',
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const result = await client.query<T>(text, values);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck() {
    if (!this.pool) return { configured: false, connected: false };
    await this.read('SELECT 1');
    return { configured: true, connected: true };
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }
}
