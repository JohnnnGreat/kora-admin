import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { CoreProvisioningService } from './core-provisioning.service';

@Module({
  imports: [AuditModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, CoreProvisioningService],
  exports: [OrganizationsService, CoreProvisioningService],
})
export class OrganizationsModule {}
