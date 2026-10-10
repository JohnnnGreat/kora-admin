import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentPlatformPrincipal } from '../platform-access/current-platform-principal.decorator';
import type { PlatformPrincipal } from '../platform-access/platform-principal';
import { RequirePlatformPermissions } from '../platform-access/require-platform-permissions.decorator';
import {
  EmailTemplateDto,
  SaveEmailCampaignDto,
  ScheduleEmailCampaignDto,
  UnsubscribeDto,
} from './dto/email-campaign.dto';
import { EmailService } from './email.service';

@Controller('emails')
@RequirePlatformPermissions('platform.configure')
export class EmailController {
  constructor(
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}
  @Get('campaigns') list() {
    return this.email.list();
  }
  @Get('campaigns/:id') find(@Param('id') id: string) {
    return this.email.find(id);
  }
  @Get('campaigns/:id/analytics') analytics(@Param('id') id: string) {
    return this.email.analytics(id);
  }
  @Post('campaigns') async create(
    @Body() dto: SaveEmailCampaignDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const campaign = await this.email.create(principal.adminId, dto);
    await this.record(
      principal,
      request,
      'email.campaign_created',
      campaign.id,
    );
    return campaign;
  }
  @Patch('campaigns/:id') async update(
    @Param('id') id: string,
    @Body() dto: SaveEmailCampaignDto,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const campaign = await this.email.update(id, dto);
    await this.record(principal, request, 'email.campaign_updated', id);
    return campaign;
  }
  @Post('campaigns/:id/preview') preview(@Param('id') id: string) {
    return this.email.preview(id);
  }
  @Post('campaigns/:id/send') async send(
    @Param('id') id: string,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const campaign = await this.email.send(id);
    await this.record(principal, request, 'email.campaign_sent', id, {
      recipientCount: campaign.recipientCount,
      sentCount: campaign.sentCount,
      failedCount: campaign.failedCount,
    });
    return campaign;
  }
  @Post('campaigns/:id/schedule') schedule(
    @Param('id') id: string,
    @Body() dto: ScheduleEmailCampaignDto,
  ) {
    return this.email.queue(id, new Date(dto.scheduledAt));
  }
  @Post('campaigns/:id/pause') async pause(
    @Param('id') id: string,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const campaign = await this.email.pause(id);
    await this.record(principal, request, 'email.campaign_paused', id);
    return campaign;
  }
  @Post('campaigns/:id/resume') async resume(
    @Param('id') id: string,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const campaign = await this.email.resume(id);
    await this.record(principal, request, 'email.campaign_resumed', id);
    return campaign;
  }
  @Post('campaigns/:id/retry-failed') async retryFailed(
    @Param('id') id: string,
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Req() request: Request,
  ) {
    const result = await this.email.retryFailed(id);
    await this.record(principal, request, 'email.campaign_retried', id, {
      retried: result.retried,
    });
    return result;
  }
  @Post('campaigns/:id/cancel') cancel(@Param('id') id: string) {
    return this.email.cancel(id);
  }
  @Get('templates') templates() {
    return this.email.templates();
  }
  @Post('templates') template(@Body() dto: EmailTemplateDto) {
    return this.email.saveTemplate(undefined, dto);
  }
  @Patch('templates/:id') templateUpdate(
    @Param('id') id: string,
    @Body() dto: EmailTemplateDto,
  ) {
    return this.email.saveTemplate(id, dto);
  }
  @Get('suppressions') suppressions() {
    return this.email.suppressions();
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
      targetType: 'email_campaign',
      targetId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      metadata,
    });
  }
}

// Unauthenticated by design: hit directly by a recipient's browser
// (unsubscribe) or by Resend's own servers (the webhook), never by a signed-
// in admin. Each verifies itself independently — a signed token for
// unsubscribe, a Svix signature for the webhook — instead of relying on
// platform permissions, which wouldn't apply to either caller anyway.
@Controller('email-events')
export class EmailEventsController {
  constructor(private readonly email: EmailService) {}
  @Post('unsubscribe') unsubscribe(@Body() dto: UnsubscribeDto) {
    return this.email.unsubscribe(dto.email, dto.token, dto.reason);
  }
  @Post('resend-webhook') async resendWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('svix-id') svixId?: string,
    @Headers('svix-timestamp') svixTimestamp?: string,
    @Headers('svix-signature') svixSignature?: string,
  ) {
    const rawBody = request.rawBody;
    if (!rawBody) throw new BadRequestException('Missing request body.');
    const verified = this.email.verifyResendWebhook(rawBody, {
      id: svixId,
      timestamp: svixTimestamp,
      signature: svixSignature,
    });
    if (!verified) throw new BadRequestException('Invalid webhook signature.');
    const event = JSON.parse(rawBody.toString('utf8')) as {
      type?: string;
      data?: { email_id?: string };
    };
    await this.email.handleResendWebhookEvent(event);
    return { received: true };
  }
}
