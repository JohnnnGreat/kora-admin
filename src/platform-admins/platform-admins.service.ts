import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { PlatformDatabaseService } from '../database/platform-database.service';
import { EmailService } from '../email/email.service';
import type { InviteAdminDto } from './dto/invite-admin.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days — matches Vercel's default

@Injectable()
export class PlatformAdminsService {
  constructor(
    private readonly database: PlatformDatabaseService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async list() {
    const admins = await this.database.platformAdmin.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        roles: { include: { role: { select: { id: true, name: true } } } },
        mfaMethods: {
          where: { verifiedAt: { not: null } },
          select: { id: true },
        },
        invitedBy: { select: { name: true } },
      },
    });
    return admins.map((admin) => ({
      id: admin.id,
      name: admin.name,
      email: admin.email,
      status: admin.status,
      roles: admin.roles.map(({ role }) => role),
      mfaEnabled: admin.mfaMethods.length > 0,
      lastLoginAt: admin.lastLoginAt,
      invitedByName: admin.invitedBy?.name ?? null,
      inviteExpiresAt: admin.inviteExpiresAt,
      createdAt: admin.createdAt,
    }));
  }

  async invite(inviterId: string, dto: InviteAdminDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.database.platformAdmin.findUnique({
      where: { email },
    });
    if (existing)
      throw new ConflictException('An admin with this email already exists.');
    const roles = await this.database.platformRole.findMany({
      where: { id: { in: dto.roleIds } },
    });
    if (roles.length !== dto.roleIds.length)
      throw new BadRequestException('One or more roles do not exist.');

    const rawToken = randomBytes(32).toString('base64url');
    const inviteTokenHash = createHash('sha256').update(rawToken).digest('hex');
    const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const admin = await this.database.platformAdmin.create({
      data: {
        email,
        name: dto.name.trim(),
        status: 'invited',
        inviteTokenHash,
        inviteExpiresAt,
        invitedById: inviterId,
        roles: {
          create: dto.roleIds.map((roleId) => ({ roleId })),
        },
      },
    });
    await this.sendInviteEmail(admin.email, admin.name, rawToken);
    return { id: admin.id, email: admin.email };
  }

  async resendInvite(id: string) {
    const admin = await this.database.platformAdmin.findUnique({
      where: { id },
    });
    if (!admin) throw new NotFoundException('Admin not found.');
    if (admin.status !== 'invited')
      throw new BadRequestException('This admin has already accepted.');

    const rawToken = randomBytes(32).toString('base64url');
    const inviteTokenHash = createHash('sha256').update(rawToken).digest('hex');
    const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await this.database.platformAdmin.update({
      where: { id },
      data: { inviteTokenHash, inviteExpiresAt },
    });
    await this.sendInviteEmail(admin.email, admin.name, rawToken);
    return { id: admin.id };
  }

  // Public-facing — no session/permission check, called from the accept-
  // invite page itself before the person has any credentials at all.
  async checkInvite(rawToken: string) {
    const admin = await this.findByInviteToken(rawToken);
    return { name: admin.name, email: admin.email };
  }

  async acceptInvite(rawToken: string, password: string) {
    const admin = await this.findByInviteToken(rawToken);
    const passwordHash = await hash(password, 12);
    await this.database.platformAdmin.update({
      where: { id: admin.id },
      data: {
        passwordHash,
        status: 'active',
        passwordSetAt: new Date(),
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
    return { email: admin.email };
  }

  async updateRoles(id: string, roleIds: string[]) {
    const roles = await this.database.platformRole.findMany({
      where: { id: { in: roleIds } },
    });
    if (roles.length !== roleIds.length)
      throw new BadRequestException('One or more roles do not exist.');
    await this.database.$transaction([
      this.database.platformAdminRole.deleteMany({ where: { adminId: id } }),
      this.database.platformAdminRole.createMany({
        data: roleIds.map((roleId) => ({ adminId: id, roleId })),
      }),
    ]);
    return { id };
  }

  async updateStatus(
    actingAdminId: string,
    id: string,
    status: 'active' | 'disabled',
  ) {
    if (id === actingAdminId)
      throw new ForbiddenException('You cannot change your own status.');
    const admin = await this.database.platformAdmin.findUnique({
      where: { id },
    });
    if (!admin) throw new NotFoundException('Admin not found.');
    if (admin.status === 'invited')
      throw new BadRequestException(
        'This admin has not accepted their invite yet.',
      );
    await this.database.platformAdmin.update({
      where: { id },
      data: { status },
    });
    if (status === 'disabled') {
      await this.database.platformSession.updateMany({
        where: { adminId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { id, status };
  }

  async removePendingInvite(id: string) {
    const admin = await this.database.platformAdmin.findUnique({
      where: { id },
    });
    if (!admin) throw new NotFoundException('Admin not found.');
    if (admin.status !== 'invited')
      throw new BadRequestException(
        'Only a pending invite can be removed this way — disable an active admin instead.',
      );
    await this.database.platformAdmin.delete({ where: { id } });
    return { id };
  }

  private async findByInviteToken(rawToken: string) {
    const inviteTokenHash = createHash('sha256').update(rawToken).digest('hex');
    const admin = await this.database.platformAdmin.findUnique({
      where: { inviteTokenHash },
    });
    if (
      !admin ||
      admin.status !== 'invited' ||
      !admin.inviteExpiresAt ||
      admin.inviteExpiresAt <= new Date()
    ) {
      throw new NotFoundException('This invite link is invalid or expired.');
    }
    return admin;
  }

  private async sendInviteEmail(email: string, name: string, rawToken: string) {
    const frontendUrl = this.config
      .getOrThrow<string>('ADMIN_FRONTEND_URL')
      .replace(/\/$/, '');
    const link = `${frontendUrl}/accept-invite?token=${encodeURIComponent(rawToken)}`;
    await this.email.sendTransactional(
      email,
      "You've been invited to Kora Control",
      `<p>Hi ${escapeHtml(name)},</p>
       <p>You've been invited to join Kora Control, the platform administration tool.</p>
       <p><a href="${link}">Accept your invite</a> to set a password and get started.</p>
       <p>This link expires in 7 days.</p>`,
    );
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
