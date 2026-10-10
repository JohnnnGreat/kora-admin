import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentPlatformPrincipal } from '../platform-access/current-platform-principal.decorator';
import type { PlatformPrincipal } from '../platform-access/platform-principal';
import { PlatformPermissionsGuard } from '../platform-access/platform-permissions.guard';
import { PlatformSessionGuard } from '../platform-access/platform-session.guard';
import { RequirePlatformPermissions } from '../platform-access/require-platform-permissions.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(PlatformSessionGuard, PlatformPermissionsGuard)
@RequirePlatformPermissions('platform.dashboard.read')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  overview(@CurrentPlatformPrincipal() principal: PlatformPrincipal) {
    return this.dashboard.overview(
      principal.permissions.includes('billing.read'),
    );
  }
}
