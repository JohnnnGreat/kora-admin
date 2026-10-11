import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CreateOrganizationDto } from './dto/create-organization.dto';
import type { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class CoreProvisioningService {
  private readonly coreUrl?: string;
  private readonly token?: string;

  constructor(config: ConfigService) {
    this.coreUrl = config.get<string>('KORA_CORE_API_URL')?.replace(/\/$/, '');
    this.token = config.get<string>('KORA_CORE_SERVICE_TOKEN');
  }

  referenceData() {
    return this.request<unknown>('/platform/provisioning/reference-data');
  }

  createOrganization(dto: CreateOrganizationDto) {
    return this.request<{
      organizationId: string;
      workspaceSlug: string;
      ownerUserId: string;
      invitationDelivery: 'sent' | 'failed';
    }>('/platform/provisioning/organizations', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  updateOrganization(id: string, dto: UpdateOrganizationDto) {
    return this.request<unknown>(`/platform/provisioning/organizations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    });
  }

  lifecycle(
    id: string,
    action: 'suspend' | 'restore' | 'archive' | 'delete',
    reason?: string,
  ) {
    return this.request<unknown>(
      `/platform/provisioning/organizations/${id}/${action}`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  }

  // Platform-managed billing's on/off switch for the workspace — distinct
  // from lifecycle()'s operationalStatus actions, which are a harder, total
  // lockout. See emrc_saas_erc's setSubscriptionStatus() for why.
  setSubscriptionStatus(
    id: string,
    status: 'active' | 'cancelled',
    reason?: string,
  ) {
    return this.request<{
      id: string;
      name: string;
      subscriptionStatus: string;
    }>(`/platform/provisioning/organizations/${id}/subscription-status`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    });
  }

  forceLogout(userId: string) {
    return this.request<{ userId: string; sessionsRevoked: number }>(
      `/platform/provisioning/users/${userId}/force-logout`,
      { method: 'POST' },
    );
  }
  requestPasswordReset(userId: string) {
    return this.request<unknown>(
      `/platform/provisioning/users/${userId}/password-reset`,
      { method: 'POST' },
    );
  }
  resendInvitation(userId: string) {
    return this.request<unknown>(
      `/platform/provisioning/users/${userId}/resend-invitation`,
      { method: 'POST' },
    );
  }

  transferOwnership(id: string, newOwnerUserId: string) {
    return this.request<unknown>(
      `/platform/provisioning/organizations/${id}/transfer-ownership`,
      { method: 'POST', body: JSON.stringify({ newOwnerUserId }) },
    );
  }

  async createImpersonation(userId: string, actorId: string) {
    const grant = await this.request<{ token: string; expiresAt: string }>(
      '/platform/provisioning/impersonation-grants',
      { method: 'POST', body: JSON.stringify({ userId, actorId }) },
    );
    return {
      launchUrl: `${this.coreUrl}/auth/platform-impersonation?token=${encodeURIComponent(grant.token)}`,
      expiresAt: grant.expiresAt,
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.coreUrl || !this.token) {
      throw new ServiceUnavailableException(
        'Core Kora provisioning is not configured.',
      );
    }
    let response: Response;
    try {
      response = await fetch(`${this.coreUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(20_000),
        headers: {
          'Content-Type': 'application/json',
          'x-kora-platform-token': this.token,
          ...init.headers,
        },
      });
    } catch {
      throw new BadGatewayException(
        'The core Kora provisioning service could not be reached.',
      );
    }
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    if (!response.ok) {
      const message = Array.isArray(body?.message)
        ? body.message.join(' ')
        : body?.message;
      throw new BadGatewayException(
        message || `Core provisioning failed (${response.status}).`,
      );
    }
    return body as T;
  }
}
