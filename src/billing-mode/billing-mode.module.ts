import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { BillingModeController } from './billing-mode.controller';
import { BillingModeService } from './billing-mode.service';

@Module({
  imports: [AuditModule, OrganizationsModule],
  controllers: [BillingModeController],
  providers: [BillingModeService],
})
export class BillingModeModule {}
