import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
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
import { RequestBackupDto } from './dto/operations.dto';
import { OperationsService } from './operations.service';

// The Operations pages: Monitoring, Queues, Storage, Backups and Releases.
// Reading needs operations.read; anything that changes something needs
// operations.manage as well, and is recorded in the audit log. The backups page
// shows copy locations and checksums, so it needs operations.manage to read, the
// same as its menu entry.
@Controller('operations')
@UseGuards(PlatformSessionGuard, PlatformPermissionsGuard)
@RequirePlatformPermissions('operations.read')
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly audit: AuditService,
  ) {}

  @Get('monitoring') monitoring(@Query('minutes') minutes?: string) {
    const parsed = Number(minutes);
    return this.operations.monitoring(
      Number.isInteger(parsed) && parsed > 0 ? parsed : undefined,
    );
  }

  @Get('queues') queues() {
    return this.operations.queues();
  }

  @Get('storage') storage(@Query('refresh') refresh?: string) {
    return this.operations.storage(refresh === 'true');
  }

  @Get('releases') releases() {
    return this.operations.releases();
  }

  @Get('backups')
  @RequirePlatformPermissions('operations.manage')
  backups() {
    return this.operations.backups();
  }

  @Post('queues/reports/jobs/:id/retry')
  @RequirePlatformPermissions('operations.read', 'operations.manage')
  async retryJob(
    @Param('id') id: string,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.operations.retryReportJob(id);
    await this.record(principal, request, 'operations.queue_job_retried', id, {
      queue: 'reports',
    });
    return result;
  }

  @Post('queues/reports/retry-failed')
  @RequirePlatformPermissions('operations.read', 'operations.manage')
  async retryAll(
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.operations.retryAllReportJobs();
    await this.record(
      principal,
      request,
      'operations.queue_retry_all',
      'reports',
      {
        queue: 'reports',
        retried: result.retried,
      },
    );
    return result;
  }

  @Post('backups/request')
  @RequirePlatformPermissions('operations.read', 'operations.manage')
  async requestBackup(
    @Body() dto: RequestBackupDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.operations.requestBackup(
      `${principal.name} <${principal.email}>`,
      dto.reason,
    );
    await this.record(
      principal,
      request,
      'operations.backup_requested',
      result.id,
      {
        reason: dto.reason ?? null,
      },
    );
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
      targetType: 'operations',
      targetId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata,
    });
  }
}
