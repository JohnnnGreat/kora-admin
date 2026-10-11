import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentPlatformPrincipal } from '../platform-access/current-platform-principal.decorator';
import type { PlatformPrincipal } from '../platform-access/platform-principal';
import { PlatformPermissionsGuard } from '../platform-access/platform-permissions.guard';
import { PlatformSessionGuard } from '../platform-access/platform-session.guard';
import { RequirePlatformPermissions } from '../platform-access/require-platform-permissions.decorator';
import { BillingModeService } from './billing-mode.service';
import {
  BulkSetBillingModeDto,
  SaveManagedBillingDto,
  SetDefaultBillingModeDto,
  SetOrganizationBillingModeDto,
} from './dto/billing-mode.dto';

@Controller('billing-mode')
@UseGuards(PlatformSessionGuard, PlatformPermissionsGuard)
@RequirePlatformPermissions('platform.configure')
export class BillingModeController {
  constructor(
    private readonly billingMode: BillingModeService,
    private readonly audit: AuditService,
  ) {}

  @Get('settings') settings() {
    return this.billingMode.getSettings();
  }
  @Patch('settings') async setDefault(
    @Body() dto: SetDefaultBillingModeDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const settings = await this.billingMode.setDefault(
      principal.adminId,
      dto.defaultMode,
    );
    await this.record(principal, request, 'billing_mode.default_changed', {
      defaultMode: dto.defaultMode,
    });
    return settings;
  }

  @Get('organizations') organizations() {
    return this.billingMode.listOrganizations();
  }
  @Get('organizations/:id') organization(@Param('id') id: string) {
    return this.billingMode.getOrganization(id);
  }
  @Patch('organizations/:id') async setOrganizationMode(
    @Param('id') id: string,
    @Body() dto: SetOrganizationBillingModeDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.billingMode.setOrganizationMode(
      principal.adminId,
      id,
      dto,
    );
    await this.record(principal, request, 'billing_mode.organization_changed', {
      organizationId: id,
      mode: dto.mode,
      note: dto.note,
    });
    return result;
  }
  @Post('organizations/bulk') async bulk(
    @Body() dto: BulkSetBillingModeDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.billingMode.bulkSetMode(principal.adminId, dto);
    await this.record(principal, request, 'billing_mode.bulk_changed', {
      mode: dto.mode,
      organizationIds: dto.organizationIds ?? 'all',
    });
    return result;
  }
  @Put('organizations/:id/managed-billing') async saveManagedBilling(
    @Param('id') id: string,
    @Body() dto: SaveManagedBillingDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.billingMode.saveManagedBilling(
      principal.adminId,
      id,
      dto,
    );
    await this.record(
      principal,
      request,
      'billing_mode.managed_billing_saved',
      { organizationId: id, planName: dto.planName },
    );
    return result;
  }

  private record(
    principal: PlatformPrincipal,
    request: Request,
    action: string,
    metadata: Prisma.InputJsonValue = {},
  ) {
    return this.audit.record({
      actorId: principal.adminId,
      action,
      targetType: 'billing_mode',
      targetId:
        (metadata as { organizationId?: string }).organizationId ?? 'global',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata,
    });
  }
}
