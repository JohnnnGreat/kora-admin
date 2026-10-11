import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import { CurrentPlatformPrincipal } from '../platform-access/current-platform-principal.decorator';
import type { PlatformPrincipal } from '../platform-access/platform-principal';
import { PlatformPermissionsGuard } from '../platform-access/platform-permissions.guard';
import { PlatformSessionGuard } from '../platform-access/platform-session.guard';
import { RequirePlatformPermissions } from '../platform-access/require-platform-permissions.decorator';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import {
  UpdateAdminRolesDto,
  UpdateAdminStatusDto,
} from './dto/update-admin.dto';
import { PlatformAdminsService } from './platform-admins.service';

@Controller('platform-admins')
@UseGuards(PlatformSessionGuard, PlatformPermissionsGuard)
@RequirePlatformPermissions('platform.configure')
export class PlatformAdminsController {
  constructor(
    private readonly admins: PlatformAdminsService,
    private readonly audit: AuditService,
  ) {}

  @Get() list() {
    return this.admins.list();
  }

  @Post('invite') async invite(
    @Body() dto: InviteAdminDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.admins.invite(principal.adminId, dto);
    await this.record(principal, request, 'platform.admin.invited', result.id, {
      email: result.email,
    });
    return result;
  }

  @Post(':id/resend-invite') async resendInvite(
    @Param('id') id: string,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.admins.resendInvite(id);
    await this.record(principal, request, 'platform.admin.invite_resent', id);
    return result;
  }

  @Put(':id/roles') async updateRoles(
    @Param('id') id: string,
    @Body() dto: UpdateAdminRolesDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.admins.updateRoles(id, dto.roleIds);
    await this.record(principal, request, 'platform.admin.roles_updated', id, {
      roleIds: dto.roleIds,
    });
    return result;
  }

  @Put(':id/status') async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAdminStatusDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.admins.updateStatus(
      principal.adminId,
      id,
      dto.status,
    );
    await this.record(principal, request, `platform.admin.${dto.status}`, id);
    return result;
  }

  @Delete(':id/invite') async removePendingInvite(
    @Param('id') id: string,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.admins.removePendingInvite(id);
    await this.record(principal, request, 'platform.admin.invite_removed', id);
    return result;
  }

  private record(
    principal: PlatformPrincipal,
    request: Request,
    action: string,
    id: string,
    metadata: Prisma.InputJsonValue = {},
  ) {
    return this.audit.record({
      actorId: principal.adminId,
      action,
      targetType: 'platform_admin',
      targetId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata,
    });
  }
}

// Unauthenticated by design: hit by someone who just received an invite
// email and has no platform session yet — same reasoning as
// EmailEventsController (unsubscribe/webhook).
@Controller('platform-admin-invites')
export class PlatformAdminInvitesController {
  constructor(private readonly admins: PlatformAdminsService) {}

  @Get(':token') check(@Param('token') token: string) {
    return this.admins.checkInvite(token);
  }

  @Post('accept') accept(@Body() dto: AcceptInviteDto) {
    return this.admins.acceptInvite(dto.token, dto.password);
  }
}
