import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlatformRolesController } from './platform-roles.controller';
import { PlatformRolesService } from './platform-roles.service';

@Module({
  imports: [AuditModule],
  controllers: [PlatformRolesController],
  providers: [PlatformRolesService],
  exports: [PlatformRolesService],
})
export class PlatformRolesModule {}
