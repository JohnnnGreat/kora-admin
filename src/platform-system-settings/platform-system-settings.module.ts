import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlatformSystemSettingsController } from './platform-system-settings.controller';
import { PlatformSystemSettingsService } from './platform-system-settings.service';

@Module({
  imports: [AuditModule],
  controllers: [PlatformSystemSettingsController],
  providers: [PlatformSystemSettingsService],
})
export class PlatformSystemSettingsModule {}
