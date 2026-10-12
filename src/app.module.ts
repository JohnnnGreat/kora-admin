import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { BillingModeModule } from './billing-mode/billing-mode.module';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EmailModule } from './email/email.module';
import { HealthModule } from './health/health.module';
import { OperationsModule } from './operations/operations.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PlatformAccessModule } from './platform-access/platform-access.module';
import { PlatformAdminsModule } from './platform-admins/platform-admins.module';
import { PlatformAuthModule } from './platform-auth/platform-auth.module';
import { PlatformRolesModule } from './platform-roles/platform-roles.module';
import { PlatformSystemSettingsModule } from './platform-system-settings/platform-system-settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    DashboardModule,
    EmailModule,
    AuditModule,
    PlatformAccessModule,
    PlatformAuthModule,
    HealthModule,
    OrganizationsModule,
    BillingModeModule,
    OperationsModule,
    PlatformRolesModule,
    PlatformAdminsModule,
    PlatformSystemSettingsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
