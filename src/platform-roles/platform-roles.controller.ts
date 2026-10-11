import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { CreateRoleDto, UpdateRoleDto } from './dto/save-role.dto';
import { PlatformRolesService } from './platform-roles.service';

@Controller('platform-roles')
@UseGuards(PlatformSessionGuard, PlatformPermissionsGuard)
@RequirePlatformPermissions('platform.configure')
export class PlatformRolesController {
  constructor(
    private readonly roles: PlatformRolesService,
    private readonly audit: AuditService,
  ) {}

  @Get() list() {
    return this.roles.list();
  }

  @Post() async create(
    @Body() dto: CreateRoleDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const role = await this.roles.create(dto);
    await this.record(principal, request, 'platform.role.created', role.id, {
      key: role.key,
    });
    return role;
  }

  @Patch(':id') async update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const role = await this.roles.update(id, dto);
    await this.record(principal, request, 'platform.role.updated', id);
    return role;
  }

  @Delete(':id') async remove(
    @Param('id') id: string,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.roles.remove(id);
    await this.record(principal, request, 'platform.role.deleted', id);
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
      targetType: 'platform_role',
      targetId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata,
    });
  }
}
