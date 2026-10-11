import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { CurrentPlatformPrincipal } from '../platform-access/current-platform-principal.decorator';
import type { PlatformPrincipal } from '../platform-access/platform-principal';
import { PlatformPermissionsGuard } from '../platform-access/platform-permissions.guard';
import { PlatformSessionGuard } from '../platform-access/platform-session.guard';
import { RequirePlatformPermissions } from '../platform-access/require-platform-permissions.decorator';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import { PlatformSystemSettingsService } from './platform-system-settings.service';

@Controller('platform-system-settings')
@UseGuards(PlatformSessionGuard, PlatformPermissionsGuard)
@RequirePlatformPermissions('platform.configure')
export class PlatformSystemSettingsController {
  constructor(
    private readonly settings: PlatformSystemSettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get() get() {
    return this.settings.get();
  }

  @Put() async update(
    @Body() dto: UpdateSystemSettingsDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.settings.update(principal.adminId, dto);
    await this.audit.record({
      actorId: principal.adminId,
      action: 'platform.system_settings.updated',
      targetType: 'platform_system_settings',
      targetId: 'default',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata: { ...dto },
    });
    return result;
  }
}
