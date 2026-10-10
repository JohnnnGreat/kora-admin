import { Module } from '@nestjs/common';
import { PlatformPermissionsGuard } from './platform-permissions.guard';
import { PlatformSessionGuard } from './platform-session.guard';

@Module({
  providers: [PlatformSessionGuard, PlatformPermissionsGuard],
  exports: [PlatformSessionGuard, PlatformPermissionsGuard],
})
export class PlatformAccessModule {}
