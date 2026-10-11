import { Injectable, NotFoundException } from '@nestjs/common';
import { PlatformDatabaseService } from '../database/platform-database.service';
import { CoreProvisioningService } from '../organizations/core-provisioning.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { ListOrganizationsDto } from '../organizations/dto/list-organizations.dto';
import type {
  BulkSetBillingModeDto,
  SaveManagedBillingDto,
  SetOrganizationBillingModeDto,
} from './dto/billing-mode.dto';

const SETTINGS_ID = 'default';

// Resolves and changes who manages an organization's billing: the
// organization itself (today's only behaviour) or the platform, centrally.
// Deliberately never writes into the tenant database — the tenant's own
// billing_subscriptions table stays exactly as organizations.service.ts
// already reads it; a platform-managed organization instead gets its own
// row in PlatformManagedBilling, a parallel record this app owns outright.
@Injectable()
export class BillingModeService {
  constructor(
    private readonly database: PlatformDatabaseService,
    private readonly organizations: OrganizationsService,
    private readonly coreProvisioning: CoreProvisioningService,
  ) {}

  async getSettings() {
    return this.database.platformBillingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID },
      update: {},
    });
  }

  async setDefault(adminId: string, defaultMode: 'self' | 'platform') {
    return this.database.platformBillingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, defaultMode, updatedById: adminId },
      update: { defaultMode, updatedById: adminId },
    });
  }

  // Every organization, each with its resolved mode (an explicit override if
  // one exists, else the global default) and, for a platform-managed one,
  // its PlatformManagedBilling record.
  async listOrganizations() {
    const [settings, { data: organizations }, overrides, managed] =
      await Promise.all([
        this.getSettings(),
        this.organizations.list(
          Object.assign(new ListOrganizationsDto(), { page: 1, pageSize: 100 }),
          true,
        ),
        this.database.platformOrganizationBillingMode.findMany({
          include: { setBy: { select: { name: true, email: true } } },
        }),
        this.database.platformManagedBilling.findMany({
          include: { updatedBy: { select: { name: true, email: true } } },
        }),
      ]);
    const overrideByOrg = new Map(
      overrides.map((row) => [row.organizationId, row]),
    );
    const managedByOrg = new Map(
      managed.map((row) => [row.organizationId, row]),
    );
    return organizations.map((organization) => {
      const override = overrideByOrg.get(organization.id);
      const mode = override?.mode ?? settings.defaultMode;
      return {
        organizationId: organization.id,
        organizationName: organization.name,
        mode,
        isOverride: Boolean(override),
        override: override
          ? {
              note: override.note,
              setAt: override.setAt,
              setByName: override.setBy.name,
            }
          : null,
        tenantBilling: {
          planName: organization.planName,
          status: organization.billingStatus,
          interval: organization.billingInterval,
          amountMinor: organization.billingAmountMinor,
          currency: organization.billingCurrency,
        },
        managedBilling: managedByOrg.get(organization.id) ?? null,
      };
    });
  }

  async getOrganization(organizationId: string) {
    const all = await this.listOrganizations();
    const found = all.find((row) => row.organizationId === organizationId);
    if (!found) throw new NotFoundException('Organization not found.');
    return found;
  }

  // Setting an org to the same mode the global default already resolves to
  // removes its override row instead of storing a redundant one — so the
  // table only ever holds genuine exceptions, and an org correctly goes
  // back to "follows the default" if the default later changes again.
  async setOrganizationMode(
    adminId: string,
    organizationId: string,
    dto: SetOrganizationBillingModeDto,
  ) {
    const settings = await this.getSettings();
    if (dto.mode === settings.defaultMode) {
      await this.database.platformOrganizationBillingMode
        .delete({ where: { organizationId } })
        .catch(() => null);
      return this.getOrganization(organizationId);
    }
    await this.database.platformOrganizationBillingMode.upsert({
      where: { organizationId },
      create: {
        organizationId,
        mode: dto.mode,
        note: dto.note,
        setById: adminId,
      },
      update: { mode: dto.mode, note: dto.note, setById: adminId },
    });
    return this.getOrganization(organizationId);
  }

  // No organizationIds = "all": changes the default itself and clears every
  // override, so every organization (including ones added after this call)
  // follows the new default — much cleaner than writing one override row
  // per tenant to say the same thing. Given organizationIds, only those get
  // an explicit override; everyone else is untouched.
  async bulkSetMode(adminId: string, dto: BulkSetBillingModeDto) {
    if (!dto.organizationIds?.length) {
      await this.database.$transaction([
        this.database.platformBillingSettings.upsert({
          where: { id: SETTINGS_ID },
          create: {
            id: SETTINGS_ID,
            defaultMode: dto.mode,
            updatedById: adminId,
          },
          update: { defaultMode: dto.mode, updatedById: adminId },
        }),
        this.database.platformOrganizationBillingMode.deleteMany({}),
      ]);
      return { scope: 'all' as const, mode: dto.mode };
    }
    const settings = await this.getSettings();
    await this.database.$transaction(
      dto.organizationIds.map((organizationId) =>
        dto.mode === settings.defaultMode
          ? this.database.platformOrganizationBillingMode.deleteMany({
              where: { organizationId },
            })
          : this.database.platformOrganizationBillingMode.upsert({
              where: { organizationId },
              create: {
                organizationId,
                mode: dto.mode,
                note: dto.note,
                setById: adminId,
              },
              update: { mode: dto.mode, note: dto.note, setById: adminId },
            }),
      ),
    );
    return {
      scope: 'selected' as const,
      mode: dto.mode,
      organizationIds: dto.organizationIds,
    };
  }

  async saveManagedBilling(
    adminId: string,
    organizationId: string,
    dto: SaveManagedBillingDto,
  ) {
    await this.database.platformManagedBilling.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planName: dto.planName,
        amountMinor: dto.amountMinor,
        currency: dto.currency ?? 'NGN',
        interval: dto.interval ?? 'monthly',
        status: dto.status ?? 'active',
        notes: dto.notes ?? '',
        updatedById: adminId,
      },
      update: {
        planName: dto.planName,
        amountMinor: dto.amountMinor,
        ...(dto.currency ? { currency: dto.currency } : {}),
        ...(dto.interval ? { interval: dto.interval } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        updatedById: adminId,
      },
    });
    const organization = await this.getOrganization(organizationId);
    // Only a platform-managed org's own workspace access is driven by this
    // record — a self-managed one's Tenant.subscriptionStatus stays
    // Paystack's exclusively, even if a stray managed-billing row exists
    // here for some other reason. "paused" deliberately isn't synced: it
    // has no equivalent in SubscriptionStatus, and conflating it with
    // "cancelled" would block a workspace over a state the admin didn't
    // actually ask to block it for.
    if (
      organization.mode === 'platform' &&
      (dto.status === 'active' || dto.status === 'cancelled')
    ) {
      await this.coreProvisioning.setSubscriptionStatus(
        organizationId,
        dto.status,
        dto.notes,
      );
    }
    return organization;
  }
}
