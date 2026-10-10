import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentPlatformPrincipal } from '../platform-access/current-platform-principal.decorator';
import { PlatformPermissionsGuard } from '../platform-access/platform-permissions.guard';
import type { PlatformPrincipal } from '../platform-access/platform-principal';
import { PlatformSessionGuard } from '../platform-access/platform-session.guard';
import { RequirePlatformPermissions } from '../platform-access/require-platform-permissions.decorator';
import { CoreProvisioningService } from './core-provisioning.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { ListOrganizationsDto } from './dto/list-organizations.dto';
import { ListPlatformUsersDto } from './dto/list-platform-users.dto';
import { ListSubscriptionsDto } from './dto/list-subscriptions.dto';
import { ListBillingTransactionsDto } from './dto/list-billing-transactions.dto';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { LifecycleActionDto } from './dto/lifecycle-action.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { OrganizationDetailQueryDto } from './dto/organization-detail-query.dto';

@Controller('organizations')
@UseGuards(PlatformSessionGuard, PlatformPermissionsGuard)
@RequirePlatformPermissions('tenant.read')
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly provisioning: CoreProvisioningService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @Query() query: ListOrganizationsDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
  ) {
    return this.organizations.list(
      query,
      principal.permissions.includes('billing.read'),
    );
  }

  @Get('provisioning/reference-data')
  @RequirePlatformPermissions('tenant.manage')
  referenceData() {
    return this.provisioning.referenceData();
  }

  @Post()
  @RequirePlatformPermissions('tenant.manage')
  async create(
    @Body() dto: CreateOrganizationDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const created = await this.provisioning.createOrganization(dto);
    await this.audit.record({
      actorId: principal.adminId,
      action: 'organization.provision',
      targetType: 'tenant',
      targetId: created.organizationId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata: {
        workspaceSlug: created.workspaceSlug,
        ownerUserId: created.ownerUserId,
        invitationDelivery: created.invitationDelivery,
      },
    });
    return created;
  }

  @Get('users')
  listUsers(@Query() query: ListPlatformUsersDto) {
    return this.organizations.listUsers(query);
  }

  @Patch(':id')
  @RequirePlatformPermissions('tenant.manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.provisioning.updateOrganization(id, dto);
    await this.recordAction(
      principal,
      request,
      'organization.update',
      'tenant',
      id,
      { ...dto },
    );
    return result;
  }

  private async lifecycle(
    id: string,
    action: 'suspend' | 'restore' | 'archive' | 'delete',
    dto: LifecycleActionDto,
    principal: PlatformPrincipal,
    request: Request,
  ) {
    const result = await this.provisioning.lifecycle(id, action, dto.reason);
    await this.recordAction(
      principal,
      request,
      `organization.${action}`,
      'tenant',
      id,
      { reason: dto.reason ?? null },
    );
    return result;
  }

  @Post(':id/suspend') @RequirePlatformPermissions('tenant.manage') suspend(
    @Param('id') id: string,
    @Body() dto: LifecycleActionDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.lifecycle(id, 'suspend', dto, principal, request);
  }
  @Post(':id/restore') @RequirePlatformPermissions('tenant.manage') restore(
    @Param('id') id: string,
    @Body() dto: LifecycleActionDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.lifecycle(id, 'restore', dto, principal, request);
  }
  @Post(':id/archive') @RequirePlatformPermissions('tenant.manage') archive(
    @Param('id') id: string,
    @Body() dto: LifecycleActionDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.lifecycle(id, 'archive', dto, principal, request);
  }
  @Post(':id/delete') @RequirePlatformPermissions('tenant.manage') delete(
    @Param('id') id: string,
    @Body() dto: LifecycleActionDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    return this.lifecycle(id, 'delete', dto, principal, request);
  }

  @Post('users/:id/force-logout')
  @RequirePlatformPermissions('tenant.manage')
  async forceLogout(
    @Param('id') id: string,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.provisioning.forceLogout(id);
    await this.recordAction(
      principal,
      request,
      'user.force_logout',
      'user',
      id,
      result,
    );
    return result;
  }

  @Post('users/:id/password-reset')
  @RequirePlatformPermissions('tenant.manage')
  async passwordReset(
    @Param('id') id: string,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.provisioning.requestPasswordReset(id);
    await this.recordAction(
      principal,
      request,
      'user.password_reset_requested',
      'user',
      id,
    );
    return result;
  }

  @Post('users/:id/resend-invitation')
  @RequirePlatformPermissions('tenant.manage')
  async resendInvitation(
    @Param('id') id: string,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.provisioning.resendInvitation(id);
    await this.recordAction(
      principal,
      request,
      'user.invitation_resent',
      'user',
      id,
    );
    return result;
  }

  @Post(':id/transfer-ownership')
  @RequirePlatformPermissions('tenant.manage')
  async transferOwnership(
    @Param('id') id: string,
    @Body() dto: TransferOwnershipDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.provisioning.transferOwnership(
      id,
      dto.newOwnerUserId,
    );
    await this.recordAction(
      principal,
      request,
      'organization.ownership_transfer',
      'tenant',
      id,
      { newOwnerUserId: dto.newOwnerUserId },
    );
    return result;
  }

  @Post('users/:id/impersonate')
  @RequirePlatformPermissions('tenant.impersonate')
  async impersonate(
    @Param('id') id: string,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.provisioning.createImpersonation(
      id,
      principal.adminId,
    );
    await this.recordAction(
      principal,
      request,
      'user.impersonation_grant_created',
      'user',
      id,
      { expiresAt: result.expiresAt },
    );
    return result;
  }

  @Get('subscriptions')
  @RequirePlatformPermissions('billing.read')
  listSubscriptions(@Query() query: ListSubscriptionsDto) {
    return this.organizations.listSubscriptions(query);
  }

  @Get('billing-transactions')
  @RequirePlatformPermissions('billing.read')
  listBillingTransactions(@Query() query: ListBillingTransactionsDto) {
    return this.organizations.listBillingTransactions(query);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query() query: OrganizationDetailQueryDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
  ) {
    return this.organizations.findOne(
      id,
      {
        billing: principal.permissions.includes('billing.read'),
        audit: principal.permissions.includes('security.read'),
      },
      query,
    );
  }

  private recordAction(
    principal: PlatformPrincipal,
    request: Request,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Prisma.InputJsonValue = {},
  ) {
    return this.audit.record({
      actorId: principal.adminId,
      action,
      targetType,
      targetId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata,
    });
  }
}
