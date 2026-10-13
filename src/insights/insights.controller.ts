import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformPermissionsGuard } from '../platform-access/platform-permissions.guard';
import { PlatformSessionGuard } from '../platform-access/platform-session.guard';
import { RequirePlatformPermissions } from '../platform-access/require-platform-permissions.decorator';
import { InsightsService } from './insights.service';

@Controller('insights')
@UseGuards(PlatformSessionGuard, PlatformPermissionsGuard)
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('platform')
  @RequirePlatformPermissions('platform.dashboard.read')
  platform() {
    return this.insights.platform();
  }

  @Get('revenue')
  @RequirePlatformPermissions('billing.read')
  revenue() {
    return this.insights.revenue();
  }

  @Get('usage')
  @RequirePlatformPermissions('platform.dashboard.read')
  usage() {
    return this.insights.usage();
  }
}
