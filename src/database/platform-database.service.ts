import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PlatformDatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private static readonly logger = new Logger(PlatformDatabaseService.name);

  constructor(config: ConfigService) {
    const pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: config.get<number>('DB_POOL_MAX', 10),
      connectionTimeoutMillis: config.get<number>(
        'DB_POOL_CONNECT_TIMEOUT_MS',
        5_000,
      ),
      idleTimeoutMillis: config.get<number>('DB_POOL_IDLE_TIMEOUT_MS', 30_000),
      application_name: 'kora-admin-api',
    });
    const adapter = new PrismaPg(pool, {
      disposeExternalPool: true,
      onPoolError: (error) =>
        PlatformDatabaseService.logger.error(
          `Platform database pool error: ${error.message}`,
        ),
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
