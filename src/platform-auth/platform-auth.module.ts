import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlatformAccessModule } from '../platform-access/platform-access.module';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';

@Module({
  imports: [AuditModule, PlatformAccessModule],
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService],
})
export class PlatformAuthModule {}
