import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../generated/prisma/client';
import { PlatformDatabaseService } from '../database/platform-database.service';
import { TenantDatabaseService } from '../database/tenant-database.service';
import type {
  EmailAudienceDto,
  SaveEmailCampaignDto,
} from './dto/email-campaign.dto';

type Recipient = {
  email: string;
  name?: string;
  userId?: string;
  organizationName?: string;
};
type UserRow = {
  id: string;
  email: string;
  name: string;
  status: string;
  role: string | null;
  department: string | null;
  organizationId: string;
  organizationName: string;
  organizationStatus: string;
};

// Thrown by deliver() specifically for an HTTP 429 from Resend, carrying how
// long it asked us to wait — processQueue() honours that delay instead of
// its own backoff schedule, which is the difference between "rate limiting"
// and just another kind of retryable failure.
class ProviderRateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('Email provider rate limit reached.');
  }
}

const RECIPIENT_BATCH_SIZE = 500;
// How many deliveries one processQueue() tick claims. Keeps each tick fast
// and bounds how many requests one worker instance fires at Resend at once —
// the closest thing to provider rate limiting this service applies on its
// own initiative, on top of honouring a 429's Retry-After.
const DELIVERY_BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;
const UNSUBSCRIBE_TOKEN_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365; // 1 year

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly database: PlatformDatabaseService,
    private readonly tenant: TenantDatabaseService,
    private readonly config: ConfigService,
  ) {}

  async create(actorId: string, dto: SaveEmailCampaignDto) {
    this.assertContent(dto.content);
    return this.database.platformEmailCampaign.create({
      data: {
        createdById: actorId,
        subject: dto.subject.trim(),
        preheader: dto.preheader?.trim() || null,
        content: dto.content as Prisma.InputJsonValue,
        audience: dto.audience as Prisma.InputJsonValue,
      },
    });
  }

  list() {
    return this.database.platformEmailCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true, email: true } } },
      take: 100,
    });
  }
  async find(id: string) {
    const campaign = await this.database.platformEmailCampaign.findUnique({
      where: { id },
      include: {
        deliveries: { orderBy: { createdAt: 'desc' }, take: 100 },
        createdBy: { select: { name: true, email: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Email campaign not found.');
    return campaign;
  }
  async update(id: string, dto: SaveEmailCampaignDto) {
    this.assertContent(dto.content);
    const campaign = await this.find(id);
    if (campaign.status !== 'draft')
      throw new BadRequestException('Only draft campaigns can be edited.');
    return this.database.platformEmailCampaign.update({
      where: { id },
      data: {
        subject: dto.subject.trim(),
        preheader: dto.preheader?.trim() || null,
        content: dto.content as Prisma.InputJsonValue,
        audience: dto.audience as Prisma.InputJsonValue,
      },
    });
  }
  async preview(id: string) {
    const campaign = await this.find(id);
    const recipients = await this.resolveRecipients(
      campaign.audience as unknown as EmailAudienceDto,
    );
    return {
      recipientCount: recipients.length,
      recipients: recipients.slice(0, 25),
      truncated: recipients.length > 25,
    };
  }

  // Legacy, synchronous path — kept only for EMAIL_QUEUE_ENABLED=false
  // (e.g. a one-off local test). The real, supported path is queue(), used
  // whenever the queue is enabled, which is the default and what
  // processQueue()'s worker loop drains.
  async send(id: string) {
    if (this.config.get<boolean>('EMAIL_QUEUE_ENABLED', true)) {
      return this.queue(id);
    }
    const campaign = await this.find(id);
    if (campaign.status !== 'draft')
      throw new BadRequestException('Only draft campaigns can be sent.');
    const recipients = await this.resolveRecipients(
      campaign.audience as unknown as EmailAudienceDto,
    );
    if (!recipients.length)
      throw new BadRequestException(
        'The selected audience has no deliverable email addresses.',
      );
    if (
      !this.config.get<string>('RESEND_API_KEY') ||
      !this.config.get<string>('EMAIL_FROM')
    )
      throw new ServiceUnavailableException(
        'Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.',
      );
    await this.database.platformEmailCampaign.update({
      where: { id },
      data: { status: 'sending', recipientCount: recipients.length },
    });
    await this.database.platformEmailDelivery.createMany({
      data: recipients.map((recipient) => ({
        campaignId: id,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        recipientUserId: recipient.userId,
      })),
      skipDuplicates: true,
    });
    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      try {
        const providerId = await this.deliver(
          recipient,
          campaign.subject,
          campaign.preheader,
          campaign.content,
        );
        await this.database.platformEmailDelivery.update({
          where: {
            campaignId_recipientEmail: {
              campaignId: id,
              recipientEmail: recipient.email,
            },
          },
          data: { status: 'sent', providerId, sentAt: new Date(), error: null },
        });
        sent += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown delivery error.';
        await this.database.platformEmailDelivery.update({
          where: {
            campaignId_recipientEmail: {
              campaignId: id,
              recipientEmail: recipient.email,
            },
          },
          data: { status: 'failed', error: message.slice(0, 2_000) },
        });
        failed += 1;
      }
    }
    return this.database.platformEmailCampaign.update({
      where: { id },
      data: {
        status: failed === recipients.length ? 'failed' : 'sent',
        sentCount: sent,
        failedCount: failed,
        sentAt: new Date(),
      },
    });
  }

  // The real send path. Resolves and writes deliveries in batches of
  // RECIPIENT_BATCH_SIZE instead of one giant array, so an audience in the
  // tens of thousands doesn't hold every row in memory at once or arrive as
  // a single multi-thousand-row INSERT.
  async queue(id: string, scheduledAt?: Date) {
    const campaign = await this.find(id);
    if (campaign.status !== 'draft')
      throw new BadRequestException('Only draft campaigns can be queued.');
    let recipientCount = 0;
    for await (const batch of this.resolveRecipientsBatched(
      campaign.audience as unknown as EmailAudienceDto,
    )) {
      if (!batch.length) continue;
      const suppressed = await this.database.platformEmailSuppression.findMany({
        where: { email: { in: batch.map((recipient) => recipient.email) } },
        select: { email: true },
      });
      const suppressedEmails = new Set(suppressed.map((item) => item.email));
      await this.database.platformEmailDelivery.createMany({
        data: batch.map((recipient) => ({
          campaignId: id,
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          recipientUserId: recipient.userId,
          status: suppressedEmails.has(recipient.email) ? 'skipped' : 'pending',
          error: suppressedEmails.has(recipient.email)
            ? 'Recipient is suppressed.'
            : null,
          nextAttemptAt: scheduledAt ?? new Date(),
        })),
        skipDuplicates: true,
      });
      recipientCount += batch.length;
    }
    if (!recipientCount)
      throw new BadRequestException(
        'The selected audience has no deliverable email addresses.',
      );
    return this.database.platformEmailCampaign.update({
      where: { id },
      data: {
        status:
          scheduledAt && scheduledAt > new Date() ? 'scheduled' : 'queued',
        scheduledAt: scheduledAt ?? null,
        recipientCount,
      },
    });
  }

  // Stops the worker from claiming any more of this campaign's deliveries —
  // processQueue() only looks at campaigns with status queued/sending, so a
  // paused one is invisible to it until resumed. Already-claimed
  // (processing) deliveries are left alone; they finish their current
  // attempt rather than being interrupted mid-flight.
  async pause(id: string) {
    const campaign = await this.find(id);
    if (!['queued', 'sending', 'scheduled'].includes(campaign.status))
      throw new BadRequestException('Only an active campaign can be paused.');
    return this.database.platformEmailCampaign.update({
      where: { id },
      data: { status: 'paused' },
    });
  }
  async resume(id: string) {
    const campaign = await this.find(id);
    if (campaign.status !== 'paused')
      throw new BadRequestException('This campaign is not paused.');
    const pending = await this.database.platformEmailDelivery.count({
      where: { campaignId: id, status: { in: ['pending', 'failed'] } },
    });
    return this.database.platformEmailCampaign.update({
      where: { id },
      data: { status: pending ? 'queued' : 'sent' },
    });
  }

  // Dead-letter handling: a delivery that exhausted MAX_ATTEMPTS sits as
  // status "failed" with no further nextAttemptAt, so processQueue() will
  // never pick it up again on its own — this is the explicit, auditable way
  // to put it back in the queue after whatever was wrong (a bad recipient
  // address fixed, the provider outage over) is actually resolved.
  async retryFailed(id: string) {
    const campaign = await this.find(id);
    const result = await this.database.platformEmailDelivery.updateMany({
      where: { campaignId: id, status: 'failed' },
      data: {
        status: 'pending',
        attempts: 0,
        error: null,
        nextAttemptAt: new Date(),
      },
    });
    if (!result.count)
      throw new BadRequestException(
        'This campaign has no failed deliveries to retry.',
      );
    if (['sent', 'failed', 'cancelled'].includes(campaign.status)) {
      await this.database.platformEmailCampaign.update({
        where: { id },
        data: { status: 'queued' },
      });
    }
    return { retried: result.count };
  }

  async processQueue() {
    if (
      !this.config.get<string>('RESEND_API_KEY') ||
      !this.config.get<string>('EMAIL_FROM')
    )
      return;
    const now = new Date();
    await this.database.platformEmailCampaign.updateMany({
      where: { status: 'scheduled', scheduledAt: { lte: now } },
      data: { status: 'queued' },
    });
    const candidates = await this.database.platformEmailDelivery.findMany({
      where: {
        status: { in: ['pending', 'failed'] },
        nextAttemptAt: { lte: now },
        campaign: { status: { in: ['queued', 'sending'] } },
      },
      include: { campaign: true },
      take: DELIVERY_BATCH_SIZE,
      orderBy: { nextAttemptAt: 'asc' },
    });
    for (const delivery of candidates) {
      const claim = await this.database.platformEmailDelivery.updateMany({
        where: { id: delivery.id, status: { in: ['pending', 'failed'] } },
        data: {
          status: 'processing',
          attempts: { increment: 1 },
          leaseUntil: new Date(Date.now() + 60_000),
        },
      });
      if (!claim.count) continue;
      try {
        const providerId = await this.deliver(
          {
            email: delivery.recipientEmail,
            name: delivery.recipientName ?? undefined,
            userId: delivery.recipientUserId ?? undefined,
          },
          delivery.campaign.subject,
          delivery.campaign.preheader,
          delivery.campaign.content,
          delivery.id,
        );
        await this.database.platformEmailDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'sent',
            providerId,
            sentAt: new Date(),
            leaseUntil: null,
            error: null,
          },
        });
      } catch (error) {
        if (error instanceof ProviderRateLimitedError) {
          // Doesn't count against the attempt's own backoff schedule — the
          // provider told us exactly how long to wait, so that's what's
          // honoured instead of our own exponential curve.
          await this.database.platformEmailDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'pending',
              error: 'Email provider rate limit reached; waiting.',
              leaseUntil: null,
              nextAttemptAt: new Date(Date.now() + error.retryAfterMs),
            },
          });
          continue;
        }
        const attempt = delivery.attempts + 1;
        const terminal = attempt >= MAX_ATTEMPTS;
        const message =
          error instanceof Error ? error.message : 'Unknown delivery error.';
        await this.database.platformEmailDelivery.update({
          where: { id: delivery.id },
          data: {
            status: terminal ? 'failed' : 'pending',
            error: message.slice(0, 2000),
            leaseUntil: null,
            nextAttemptAt: terminal
              ? null
              : new Date(
                  Date.now() + Math.min(3_600_000, 60_000 * 2 ** attempt),
                ),
          },
        });
      }
    }
    const active = await this.database.platformEmailCampaign.findMany({
      where: { status: { in: ['queued', 'sending'] } },
      include: { deliveries: { select: { status: true } } },
      take: 100,
    });
    await Promise.all(
      active.map((campaign) => {
        const sent = campaign.deliveries.filter((item) =>
          ['sent', 'delivered', 'opened'].includes(item.status),
        ).length;
        const failed = campaign.deliveries.filter(
          (item) => item.status === 'failed',
        ).length;
        const pending = campaign.deliveries.some((item) =>
          ['pending', 'processing'].includes(item.status),
        );
        return this.database.platformEmailCampaign.update({
          where: { id: campaign.id },
          data: {
            status: pending
              ? 'sending'
              : failed === campaign.deliveries.length
                ? 'failed'
                : 'sent',
            sentCount: sent,
            failedCount: failed,
            sentAt: pending ? null : new Date(),
          },
        });
      }),
    );
  }

  async cancel(id: string) {
    const campaign = await this.find(id);
    if (
      !['draft', 'scheduled', 'queued', 'sending', 'paused'].includes(
        campaign.status,
      )
    )
      throw new BadRequestException(
        'This campaign can no longer be cancelled.',
      );
    await this.database.platformEmailDelivery.updateMany({
      where: { campaignId: id, status: { in: ['pending', 'processing'] } },
      data: {
        status: 'skipped',
        error: 'Campaign cancelled.',
        nextAttemptAt: null,
      },
    });
    return this.database.platformEmailCampaign.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
  }

  // Counts by delivery status — the analytics a webhook makes meaningful:
  // without handleResendWebhook() updating delivered/opened/bounced/
  // complained, every delivery would just sit at "sent" forever.
  async analytics(id: string) {
    const campaign = await this.find(id);
    const counts = await this.database.platformEmailDelivery.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: { _all: true },
    });
    const byStatus = Object.fromEntries(
      counts.map((row) => [row.status, row._count._all]),
    ) as Record<string, number>;
    const sentOrBetter =
      (byStatus.sent ?? 0) + (byStatus.delivered ?? 0) + (byStatus.opened ?? 0);
    return {
      campaignId: id,
      recipientCount: campaign.recipientCount,
      byStatus,
      deliveredRate: sentOrBetter
        ? (byStatus.delivered ?? 0) / sentOrBetter
        : 0,
      openRate: sentOrBetter ? (byStatus.opened ?? 0) / sentOrBetter : 0,
      bounceRate: sentOrBetter
        ? (byStatus.bounced ?? 0) / (sentOrBetter + (byStatus.bounced ?? 0))
        : 0,
      complaintRate: sentOrBetter
        ? (byStatus.complained ?? 0) /
          (sentOrBetter + (byStatus.complained ?? 0))
        : 0,
    };
  }

  templates() {
    return this.database.platformEmailTemplate.findMany({
      orderBy: { updatedAt: 'desc' },
    });
  }
  saveTemplate(
    id: string | undefined,
    dto: {
      name: string;
      subject: string;
      preheader?: string;
      content: Record<string, unknown>;
    },
  ) {
    this.assertContent(dto.content);
    const data = {
      ...dto,
      preheader: dto.preheader ?? null,
      content: dto.content as Prisma.InputJsonValue,
    };
    return id
      ? this.database.platformEmailTemplate.update({ where: { id }, data })
      : this.database.platformEmailTemplate.create({ data });
  }

  // HMAC-signed, so only a link this service itself put in a sent email is
  // accepted — email addresses are easy to guess, and an unauthenticated
  // unsubscribe-by-email endpoint would let anyone suppress anyone.
  unsubscribeToken(email: string): string {
    const secret = this.config.get<string>('EMAIL_UNSUBSCRIBE_SECRET');
    if (!secret) return '';
    const timestamp = Date.now().toString(36);
    const signature = createHmac('sha256', secret)
      .update(`${email.toLowerCase()}.${timestamp}`)
      .digest('base64url');
    return `${timestamp}.${signature}`;
  }
  verifyUnsubscribeToken(email: string, token: string): boolean {
    const secret = this.config.get<string>('EMAIL_UNSUBSCRIBE_SECRET');
    if (!secret) return false;
    const [timestamp, signature] = token.split('.');
    if (!timestamp || !signature) return false;
    const age = Date.now() - parseInt(timestamp, 36);
    if (!Number.isFinite(age) || age < 0 || age > UNSUBSCRIBE_TOKEN_MAX_AGE_MS)
      return false;
    const expected = createHmac('sha256', secret)
      .update(`${email.toLowerCase()}.${timestamp}`)
      .digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  unsubscribe(email: string, token: string, reason = 'Unsubscribed') {
    if (!this.verifyUnsubscribeToken(email, token))
      throw new BadRequestException(
        'This unsubscribe link is invalid or has expired.',
      );
    return this.database.platformEmailSuppression.upsert({
      where: { email: email.toLowerCase() },
      create: { email: email.toLowerCase(), reason },
      update: { reason },
    });
  }
  suppressions() {
    return this.database.platformEmailSuppression.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  // Resend wraps its webhooks with Svix: svix-id/svix-timestamp form the
  // signed content together with the exact raw request body, and
  // svix-signature carries one or more "v1,<base64 hmac>" values to check it
  // against — any match is accepted, which is how Svix itself rotates
  // signing keys without a delivery gap. Needs the untouched byte stream
  // (see main.ts's `rawBody: true`), not Nest's already-parsed JSON, because
  // re-serializing it is not guaranteed to reproduce the same bytes.
  verifyResendWebhook(
    rawBody: Buffer,
    headers: { id?: string; timestamp?: string; signature?: string },
  ): boolean {
    const secret = this.config.get<string>('RESEND_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.warn(
        'RESEND_WEBHOOK_SECRET is not set — accepting webhook unverified. Set it before relying on delivery/open/bounce data.',
      );
      return true;
    }
    if (!headers.id || !headers.timestamp || !headers.signature) return false;
    const age = Math.abs(Date.now() / 1000 - Number(headers.timestamp));
    if (!Number.isFinite(age) || age > 300) return false; // 5 minute tolerance
    const signedContent = `${headers.id}.${headers.timestamp}.${rawBody.toString('utf8')}`;
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = createHmac('sha256', key)
      .update(signedContent)
      .digest('base64');
    return headers.signature
      .split(' ')
      .map((part) => part.split(',')[1])
      .filter((value): value is string => Boolean(value))
      .some((candidate) => {
        const a = Buffer.from(candidate, 'base64');
        const b = Buffer.from(expected, 'base64');
        return a.length === b.length && timingSafeEqual(a, b);
      });
  }

  // Updates delivery lifecycle timestamps from Resend's own events — the
  // only thing that ever populates deliveredAt/openedAt/bouncedAt/
  // complainedAt and, through those, analytics(). A bounce or a complaint
  // also suppresses the address immediately, the same as an explicit
  // unsubscribe, so the next campaign skips it automatically.
  async handleResendWebhookEvent(event: {
    type?: string;
    data?: { email_id?: string; to?: string[] };
  }) {
    const providerId = event.data?.email_id;
    if (!providerId) return;
    const delivery = await this.database.platformEmailDelivery.findFirst({
      where: { providerId },
    });
    if (!delivery) return;
    const now = new Date();
    switch (event.type) {
      case 'email.delivered':
        await this.database.platformEmailDelivery.update({
          where: { id: delivery.id },
          data: { status: 'delivered', deliveredAt: now },
        });
        break;
      case 'email.opened':
        await this.database.platformEmailDelivery.update({
          where: { id: delivery.id },
          data: { openedAt: delivery.openedAt ?? now, status: 'opened' },
        });
        break;
      case 'email.bounced':
        await this.database.platformEmailDelivery.update({
          where: { id: delivery.id },
          data: { status: 'bounced', bouncedAt: now, error: 'Bounced.' },
        });
        await this.database.platformEmailSuppression.upsert({
          where: { email: delivery.recipientEmail },
          create: { email: delivery.recipientEmail, reason: 'Bounced' },
          update: { reason: 'Bounced' },
        });
        break;
      case 'email.complained':
        await this.database.platformEmailDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'complained',
            complainedAt: now,
            error: 'Recipient marked this as spam.',
          },
        });
        await this.database.platformEmailSuppression.upsert({
          where: { email: delivery.recipientEmail },
          create: { email: delivery.recipientEmail, reason: 'Complained' },
          update: { reason: 'Complained' },
        });
        break;
      default:
        break;
    }
  }

  // Full, non-batched resolution — used by preview() (wants an exact total
  // plus a handful of examples) and the legacy synchronous send() path.
  // The production path (queue()) uses resolveRecipientsBatched() below
  // instead so a very large audience is never held in memory as one array.
  private async resolveRecipients(
    audience: EmailAudienceDto,
  ): Promise<Recipient[]> {
    const all: Recipient[] = [];
    for await (const batch of this.resolveRecipientsBatched(audience)) {
      all.push(...batch);
    }
    return all;
  }

  // Yields recipients in pages of RECIPIENT_BATCH_SIZE instead of resolving
  // the whole audience into one array — direct addresses always come first,
  // as their own (small) batch, then the directory query pages through with
  // LIMIT/OFFSET.
  private async *resolveRecipientsBatched(
    audience: EmailAudienceDto,
  ): AsyncGenerator<Recipient[]> {
    const seen = new Set<string>();
    const direct: Recipient[] = [];
    for (const email of audience.directEmails ?? []) {
      const lower = email.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      direct.push({ email: lower });
    }
    if (direct.length) yield direct;

    const hasDirectoryCriteria =
      audience.userIds?.length ||
      audience.organizationIds?.length ||
      audience.userStatus ||
      audience.organizationStatus ||
      audience.organizationName ||
      audience.role ||
      audience.department;
    if (!hasDirectoryCriteria) return;
    if (!this.tenant.isConfigured())
      throw new ServiceUnavailableException(
        'Tenant database access is required for platform recipient targeting.',
      );

    const values: unknown[] = [];
    const conditions: string[] = [];
    const add = (value: unknown, sql: string) => {
      values.push(value);
      conditions.push(sql.replace('?', `$${values.length}`));
    };
    if (audience.userIds?.length)
      add(audience.userIds, 'u.id = ANY(?::text[])');
    if (audience.organizationIds?.length)
      add(audience.organizationIds, 'u."tenantId" = ANY(?::text[])');
    if (audience.userStatus) add(audience.userStatus, 'u.status::text = ?');
    if (audience.organizationStatus)
      add(audience.organizationStatus, 't."subscriptionStatus"::text = ?');
    if (audience.organizationName)
      add(`%${audience.organizationName}%`, 't.name ILIKE ?');
    if (audience.role) add(`%${audience.role}%`, 'r.name ILIKE ?');
    if (audience.department) add(`%${audience.department}%`, 'd.name ILIKE ?');

    let offset = 0;
    for (;;) {
      const limitIndex = values.length + 1;
      const offsetIndex = values.length + 2;
      const rows = await this.tenant.read<UserRow>(
        `SELECT u.id, u.email, u.name, u.status::text AS status, r.name AS role, d.name AS department, t.id AS "organizationId", t.name AS "organizationName", t."subscriptionStatus"::text AS "organizationStatus" FROM users u JOIN tenants t ON t.id = u."tenantId" LEFT JOIN roles r ON r.id = u."roleId" LEFT JOIN departments d ON d.id = u."departmentId" WHERE ${conditions.join(' AND ')} AND u.email IS NOT NULL ORDER BY u.id LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        [...values, RECIPIENT_BATCH_SIZE, offset],
      );
      const batch: Recipient[] = [];
      for (const row of rows.rows) {
        const lower = row.email.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        batch.push({
          email: lower,
          name: row.name,
          userId: row.id,
          organizationName: row.organizationName,
        });
      }
      if (batch.length) yield batch;
      if (rows.rows.length < RECIPIENT_BATCH_SIZE) break;
      offset += RECIPIENT_BATCH_SIZE;
    }
  }

  private assertContent(content: Record<string, unknown>) {
    if (!Array.isArray(content.blocks) || content.blocks.length === 0)
      throw new BadRequestException(
        'Email content must contain at least one Editor.js block.',
      );
  }

  private async deliver(
    recipient: Recipient,
    subject: string,
    preheader: string | null,
    content: unknown,
    idempotencyKey?: string,
  ) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.getOrThrow<string>('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: this.config.getOrThrow<string>('EMAIL_FROM'),
        to: [recipient.email],
        subject,
        html: this.render(content, preheader, recipient),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader
        ? Number(retryAfterHeader)
        : 60;
      await response.body?.cancel().catch(() => {});
      throw new ProviderRateLimitedError(
        Math.max(
          5_000,
          (Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 60) * 1000,
        ),
      );
    }
    const body = (await response.json().catch(() => null)) as {
      id?: string;
      message?: string;
    } | null;
    if (!response.ok)
      throw new BadGatewayException(
        body?.message || `Email provider failed (${response.status}).`,
      );
    return body?.id ?? null;
  }

  // Merge variables are substituted into each block's raw text before
  // escaping, so {{name}} etc. can never itself inject markup, and a
  // signed, per-recipient unsubscribe link is always appended — every
  // address this goes to had it added to the template, not just the ones an
  // admin remembered to type in manually.
  private render(
    content: unknown,
    preheader: string | null,
    recipient: Recipient,
  ) {
    const blocks =
      (
        content as {
          blocks?: Array<{
            type?: string;
            data?: { text?: string; items?: string[] };
          }>;
        }
      ).blocks ?? [];
    const escape = (value: string) =>
      value.replace(
        /[&<>"']/g,
        (char) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[char] as string,
      );
    const mergeVars: Record<string, string> = {
      name: recipient.name ?? 'there',
      email: recipient.email,
      organizationname: recipient.organizationName ?? '',
    };
    const merge = (value: string) =>
      value.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key: string) => {
        const resolved = mergeVars[key.toLowerCase()];
        return resolved !== undefined ? resolved : match;
      });
    const body = blocks
      .map((block) => {
        const text = escape(
          merge(String(block.data?.text ?? '').replace(/<[^>]*>/g, '')),
        );
        if (block.type === 'header') return `<h2>${text}</h2>`;
        if (block.type === 'list')
          return `<ul>${(block.data?.items ?? [])
            .map(
              (item) =>
                `<li>${escape(merge(item.replace(/<[^>]*>/g, '')))}</li>`,
            )
            .join('')}</ul>`;
        return `<p>${text}</p>`;
      })
      .join('');
    const token = this.unsubscribeToken(recipient.email);
    const frontendUrl = this.config
      .get<string>('ADMIN_FRONTEND_URL', '')
      .replace(/\/$/, '');
    const unsubscribeUrl = token
      ? `${frontendUrl}/unsubscribe?email=${encodeURIComponent(recipient.email)}&token=${encodeURIComponent(token)}`
      : null;
    const footer = unsubscribeUrl
      ? `<p style="margin-top:32px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:16px">You are receiving this because you have an account with EMRC Platform. <a href="${unsubscribeUrl}" style="color:#6b7280">Unsubscribe</a></p>`
      : '';
    return `${preheader ? `<span style="display:none">${escape(preheader)}</span>` : ''}<main>${body}</main>${footer}`;
  }
}
