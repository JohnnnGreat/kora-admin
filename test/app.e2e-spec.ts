import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap/configure-application';
import { PlatformDatabaseService } from '../src/database/platform-database.service';
import { TenantDatabaseService } from '../src/database/tenant-database.service';

describe('Admin API health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PlatformDatabaseService)
      .useValue({ $queryRaw: jest.fn().mockResolvedValue([{ value: 1 }]) })
      .overrideProvider(TenantDatabaseService)
      .useValue({
        healthCheck: jest
          .fn()
          .mockResolvedValue({ configured: false, connected: false }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => app?.close());

  it('reports liveness', async () => {
    await request(app.getHttpServer())
      .get('/api/health/live')
      .expect(200)
      .expect({ status: 'ok', service: 'kora-admin-api' });
  });

  it('reports readiness without pretending tenant access is configured', async () => {
    await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200)
      .expect({
        status: 'ready',
        databases: {
          platform: { configured: true, connected: true },
          tenant: { configured: false, connected: false },
        },
      });
  });
});
