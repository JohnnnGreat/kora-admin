import { Injectable, NotFoundException } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { TenantDatabaseService } from '../database/tenant-database.service';
import type { ListOrganizationsDto } from './dto/list-organizations.dto';
import type { ListPlatformUsersDto } from './dto/list-platform-users.dto';
import type { ListSubscriptionsDto } from './dto/list-subscriptions.dto';
import type { ListBillingTransactionsDto } from './dto/list-billing-transactions.dto';
import type { OrganizationDetailQueryDto } from './dto/organization-detail-query.dto';

type CountRow = QueryResultRow & { count: string };

type OrganizationRow = QueryResultRow & {
  id: string;
  identifier: string;
  name: string;
  workspaceSlug: string | null;
  country: string | null;
  industry: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  address: string | null;
  defaultCurrency: string;
  timezone: string;
  status: string;
  operationalStatus: string;
  operationalReason: string | null;
  ownerUserId: string | null;
  trialEndsAt: Date | null;
  subscriptionRenewsAt: Date | null;
  paidThroughAt: Date | null;
  cancelAtPeriodEnd: boolean;
  userLimit: number;
  createdAt: Date;
  updatedAt: Date;
  planId: string | null;
  planName: string | null;
  billingStatus: string | null;
  billingInterval: string | null;
  billingAmountMinor: number | null;
  billingCurrency: string | null;
  seatCount: number | null;
  userCount: string;
  projectCount: string;
  enabledModuleCount: string;
  lastActivityAt: Date | null;
};

type PlatformUserRow = QueryResultRow & {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  organizationId: string;
  organizationName: string;
  workspaceSlug: string | null;
  role: string | null;
  department: string | null;
  lastLoginAt: Date | null;
};

const ORGANIZATION_SELECT = `
  SELECT
    t.id,
    t.identifier,
    t.name,
    t."workspaceSlug",
    t.country,
    t.industry,
    t."logoUrl",
    t."contactEmail",
    t."contactPhone",
    t.website,
    t.address,
    t."defaultCurrency"::text AS "defaultCurrency",
    t.timezone,
    t."subscriptionStatus"::text AS status,
    t."operationalStatus"::text AS "operationalStatus",
    t."operationalReason",
    t."ownerUserId",
    t."trialEndsAt",
    t."subscriptionRenewsAt",
    t."paidThroughAt",
    t."cancelAtPeriodEnd",
    t."userLimit",
    t."createdAt",
    t."updatedAt",
    sp.id AS "planId",
    sp.name AS "planName",
    bs.status::text AS "billingStatus",
    bs.interval::text AS "billingInterval",
    bs."amountMinor" AS "billingAmountMinor",
    bs.currency::text AS "billingCurrency",
    bs."seatCount",
    COALESCE(uc.count, 0)::text AS "userCount",
    COALESCE(pc.count, 0)::text AS "projectCount",
    COALESCE(mc.count, 0)::text AS "enabledModuleCount",
    GREATEST(t."updatedAt", uc."lastActivityAt", pc."lastActivityAt") AS "lastActivityAt"
  FROM tenants t
  LEFT JOIN subscription_plans sp ON sp.id = t."planId"
  LEFT JOIN billing_subscriptions bs ON bs."tenantId" = t.id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS count, MAX(GREATEST(u."updatedAt", rt."lastUsedAt")) AS "lastActivityAt"
    FROM users u
    LEFT JOIN LATERAL (
      SELECT MAX(r."lastUsedAt") AS "lastUsedAt"
      FROM refresh_tokens r
      WHERE r."userId" = u.id
    ) rt ON TRUE
    WHERE u."tenantId" = t.id
  ) uc ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS count, MAX(p."updatedAt") AS "lastActivityAt"
    FROM projects p
    WHERE p."tenantId" = t.id
  ) pc ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS count
    FROM tenant_modules tm
    WHERE tm."tenantId" = t.id
  ) mc ON TRUE
`;

@Injectable()
export class OrganizationsService {
  constructor(private readonly tenantDatabase: TenantDatabaseService) {}

  async list(query: ListOrganizationsDto, includeBilling = false) {
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (query.search?.trim()) {
      values.push(`%${query.search.trim()}%`);
      conditions.push(
        `(t.name ILIKE $${values.length} OR COALESCE(t."workspaceSlug", '') ILIKE $${values.length} OR COALESCE(t.country, '') ILIKE $${values.length})`,
      );
    }
    if (query.status) {
      values.push(query.status);
      conditions.push(`t."subscriptionStatus"::text = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.pageSize;
    const rowsValues = [...values, query.pageSize, offset];

    const [rows, count] = await Promise.all([
      this.tenantDatabase.read<OrganizationRow>(
        `${ORGANIZATION_SELECT} ${where}
         ORDER BY t."createdAt" DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        rowsValues,
      ),
      this.tenantDatabase.read<CountRow>(
        `SELECT COUNT(*)::text AS count FROM tenants t ${where}`,
        values,
      ),
    ]);

    const total = Number(count.rows[0]?.count ?? 0);
    return {
      data: rows.rows.map((row) => this.mapOrganization(row, includeBilling)),
      pagination: this.pagination(total, query.page, query.pageSize),
    };
  }

  async findOne(
    id: string,
    access: { billing: boolean; audit: boolean } = {
      billing: false,
      audit: false,
    },
    query: OrganizationDetailQueryDto = { page: 1, pageSize: 25 },
  ) {
    const organizationResult = await this.tenantDatabase.read<OrganizationRow>(
      `${ORGANIZATION_SELECT} WHERE t.id = $1`,
      [id],
    );
    const organization = organizationResult.rows[0];
    if (!organization) throw new NotFoundException('Organization not found.');

    const emptyRows = Promise.resolve({ rows: [] });
    const offset = (query.page - 1) * query.pageSize;
    const [
      modules,
      users,
      departments,
      billingTransactions,
      billingProfile,
      projects,
      auditLogs,
      userCount,
      projectCount,
      billingTransactionCount,
      auditLogCount,
    ] = await Promise.all([
      this.tenantDatabase.read<
        QueryResultRow & {
          id: string;
          name: string;
          description: string | null;
          category: string;
          enabledAt: Date;
        }
      >(
        `SELECT m.id, m.name, m.description, m.category, tm."enabledAt"
         FROM tenant_modules tm
         JOIN modules m ON m.id = tm."moduleId"
         WHERE tm."tenantId" = $1
         ORDER BY m."sortOrder", m.name`,
        [id],
      ),
      this.tenantDatabase.read<PlatformUserRow>(
        `${this.platformUserSelect()} WHERE u."tenantId" = $1
         ORDER BY u."createdAt" DESC LIMIT $2 OFFSET $3`,
        [id, query.pageSize, offset],
      ),
      this.tenantDatabase.read<
        QueryResultRow & {
          id: string;
          name: string;
          code: string;
          status: string;
          description: string | null;
          manager: string | null;
          parentDepartment: string | null;
          userCount: string;
          createdAt: Date;
        }
      >(
        `SELECT d.id, d.name, d.code, d.status, d.description,
          manager.name AS manager, parent.name AS "parentDepartment",
          COUNT(u.id)::text AS "userCount", d."createdAt"
         FROM departments d
         LEFT JOIN users manager ON manager.id = d."managerId"
         LEFT JOIN departments parent ON parent.id = d."parentDepartmentId"
         LEFT JOIN users u ON u."departmentId" = d.id
         WHERE d."tenantId" = $1
         GROUP BY d.id, manager.name, parent.name
         ORDER BY d.name`,
        [id],
      ),
      access.billing
        ? this.tenantDatabase.read<
            QueryResultRow & {
              id: string;
              reference: string;
              provider: string;
              kind: string;
              amountMinor: number;
              currency: string;
              status: string;
              providerMessage: string | null;
              paidAt: Date | null;
              createdAt: Date;
            }
          >(
            `SELECT id, reference, provider, kind::text AS kind, "amountMinor",
          currency::text AS currency, status::text AS status,
          "providerMessage", "paidAt", "createdAt"
         FROM payment_transactions
             WHERE "tenantId" = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3`,
            [id, query.pageSize, offset],
          )
        : emptyRows,
      access.billing
        ? this.tenantDatabase.read<
            QueryResultRow & {
              billingName: string;
              billingEmail: string;
              billingAddress: string;
              taxId: string | null;
              paymentMethodBrand: string | null;
              paymentMethodLast4: string | null;
              paymentMethodExpMonth: string | null;
              paymentMethodExpYear: string | null;
            }
          >(
            `SELECT "billingName", "billingEmail", "billingAddress", "taxId",
              "paymentMethodBrand", "paymentMethodLast4", "paymentMethodExpMonth",
              "paymentMethodExpYear"
             FROM billing_profiles WHERE "tenantId" = $1`,
            [id],
          )
        : emptyRows,
      this.tenantDatabase.read<
        QueryResultRow & {
          id: string;
          code: string;
          name: string;
          stage: string;
          health: string;
          owner: string | null;
          value: number;
          currency: string;
          createdAt: Date;
          updatedAt: Date;
        }
      >(
        `SELECT p.id, p.code, p.name, p.stage, p.health, owner.name AS owner,
                p.value, p.currency, p."createdAt", p."updatedAt"
         FROM projects p
         LEFT JOIN users owner ON owner.id = p."ownerId"
         WHERE p."tenantId" = $1
         ORDER BY p."updatedAt" DESC LIMIT $2 OFFSET $3`,
        [id, query.pageSize, offset],
      ),
      access.audit
        ? this.tenantDatabase.read<
            QueryResultRow & {
              id: string;
              action: string;
              summary: string | null;
              actorName: string | null;
              actorEmail: string | null;
              recordType: string | null;
              recordLabel: string | null;
              outcome: string;
              createdAt: Date;
            }
          >(
            `SELECT id, action, summary, "actorName", "actorEmail", "recordType",
                    "recordLabel", outcome, "createdAt"
             FROM audit_logs
             WHERE "tenantId" = $1
             ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3`,
            [id, query.pageSize, offset],
          )
        : emptyRows,
      this.tenantDatabase.read<CountRow>(
        'SELECT COUNT(*)::text AS count FROM users WHERE "tenantId" = $1',
        [id],
      ),
      this.tenantDatabase.read<CountRow>(
        'SELECT COUNT(*)::text AS count FROM projects WHERE "tenantId" = $1',
        [id],
      ),
      access.billing
        ? this.tenantDatabase.read<CountRow>(
            'SELECT COUNT(*)::text AS count FROM payment_transactions WHERE "tenantId" = $1',
            [id],
          )
        : Promise.resolve({ rows: [{ count: '0' }] }),
      access.audit
        ? this.tenantDatabase.read<CountRow>(
            'SELECT COUNT(*)::text AS count FROM audit_logs WHERE "tenantId" = $1',
            [id],
          )
        : Promise.resolve({ rows: [{ count: '0' }] }),
    ]);

    return {
      access,
      organization: this.mapOrganization(organization, access.billing),
      modules: modules.rows,
      users: users.rows.map((row) => this.mapUser(row)),
      projects: projects.rows,
      departments: departments.rows.map((row) => ({
        ...row,
        userCount: Number(row.userCount),
      })),
      billingTransactions: billingTransactions.rows,
      billingProfile: billingProfile.rows[0] ?? null,
      auditLogs: auditLogs.rows,
      pagination: {
        users: this.pagination(
          Number(userCount.rows[0]?.count ?? 0),
          query.page,
          query.pageSize,
        ),
        projects: this.pagination(
          Number(projectCount.rows[0]?.count ?? 0),
          query.page,
          query.pageSize,
        ),
        billingTransactions: this.pagination(
          Number(billingTransactionCount.rows[0]?.count ?? 0),
          query.page,
          query.pageSize,
        ),
        auditLogs: this.pagination(
          Number(auditLogCount.rows[0]?.count ?? 0),
          query.page,
          query.pageSize,
        ),
      },
    };
  }

  async listUsers(query: ListPlatformUsersDto) {
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (query.search?.trim()) {
      values.push(`%${query.search.trim()}%`);
      conditions.push(
        `(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length} OR t.name ILIKE $${values.length})`,
      );
    }
    if (query.status) {
      values.push(query.status);
      conditions.push(`u.status::text = $${values.length}`);
    }
    if (query.organizationId) {
      values.push(query.organizationId);
      conditions.push(`u."tenantId" = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.pageSize;
    const [rows, count] = await Promise.all([
      this.tenantDatabase.read<PlatformUserRow>(
        `${this.platformUserSelect()} ${where}
         ORDER BY u."createdAt" DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, offset],
      ),
      this.tenantDatabase.read<CountRow>(
        `SELECT COUNT(*)::text AS count FROM users u
         JOIN tenants t ON t.id = u."tenantId" ${where}`,
        values,
      ),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    return {
      data: rows.rows.map((row) => this.mapUser(row)),
      pagination: this.pagination(total, query.page, query.pageSize),
    };
  }

  async listSubscriptions(query: ListSubscriptionsDto) {
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (query.search?.trim()) {
      values.push(`%${query.search.trim()}%`);
      conditions.push(
        `(t.name ILIKE $${values.length} OR COALESCE(t."workspaceSlug", '') ILIKE $${values.length} OR COALESCE(sp.name, '') ILIKE $${values.length})`,
      );
    }
    if (query.status === 'none') {
      conditions.push('bs.id IS NULL');
    } else if (query.status) {
      values.push(query.status);
      conditions.push(`bs.status::text = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.pageSize;
    const [rows, count] = await Promise.all([
      this.tenantDatabase.read<
        QueryResultRow & {
          id: string;
          organizationId: string;
          organizationName: string;
          workspaceSlug: string | null;
          tenantStatus: string;
          planName: string | null;
          status: string | null;
          interval: string | null;
          seatCount: number | null;
          amountMinor: number | null;
          currency: string | null;
          nextPaymentAt: Date | null;
          paidThroughAt: Date | null;
          cancelAtPeriodEnd: boolean | null;
          trialEndsAt: Date | null;
          createdAt: Date;
          updatedAt: Date;
        }
      >(
        `SELECT COALESCE(bs.id, t.id) AS id, t.id AS "organizationId",
          t.name AS "organizationName", t."workspaceSlug",
          t."subscriptionStatus"::text AS "tenantStatus", sp.name AS "planName",
          bs.status::text AS status, bs.interval::text AS interval,
          bs."seatCount", bs."amountMinor", bs.currency::text AS currency,
          bs."nextPaymentAt", bs."paidThroughAt", bs."cancelAtPeriodEnd",
          t."trialEndsAt", COALESCE(bs."createdAt", t."createdAt") AS "createdAt",
          COALESCE(bs."updatedAt", t."updatedAt") AS "updatedAt"
        FROM tenants t
        LEFT JOIN billing_subscriptions bs ON bs."tenantId" = t.id
        LEFT JOIN subscription_plans sp ON sp.id = COALESCE(bs."planId", t."planId")
        ${where} ORDER BY COALESCE(bs."updatedAt", t."updatedAt") DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, offset],
      ),
      this.tenantDatabase.read<CountRow>(
        `SELECT COUNT(*)::text AS count FROM tenants t
         LEFT JOIN billing_subscriptions bs ON bs."tenantId" = t.id
         LEFT JOIN subscription_plans sp ON sp.id = COALESCE(bs."planId", t."planId")
         ${where}`,
        values,
      ),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    return {
      data: rows.rows,
      pagination: this.pagination(total, query.page, query.pageSize),
    };
  }

  async listBillingTransactions(query: ListBillingTransactionsDto) {
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (query.search?.trim()) {
      values.push(`%${query.search.trim()}%`);
      conditions.push(
        `(t.name ILIKE $${values.length} OR pt.reference ILIKE $${values.length} OR COALESCE(pt."providerTransactionId", '') ILIKE $${values.length})`,
      );
    }
    if (query.status) {
      values.push(query.status);
      conditions.push(`pt.status::text = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.pageSize;
    const [rows, count, summary] = await Promise.all([
      this.tenantDatabase.read<
        QueryResultRow & {
          id: string;
          organizationId: string;
          organizationName: string;
          reference: string;
          providerTransactionId: string | null;
          provider: string;
          kind: string;
          amountMinor: number;
          currency: string;
          status: string;
          providerMessage: string | null;
          paidAt: Date | null;
          createdAt: Date;
        }
      >(
        `SELECT pt.id, t.id AS "organizationId", t.name AS "organizationName",
          pt.reference, pt."providerTransactionId", pt.provider,
          pt.kind::text AS kind, pt."amountMinor", pt.currency::text AS currency,
          pt.status::text AS status, pt."providerMessage", pt."paidAt", pt."createdAt"
        FROM payment_transactions pt JOIN tenants t ON t.id = pt."tenantId"
        ${where} ORDER BY pt."createdAt" DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, offset],
      ),
      this.tenantDatabase.read<CountRow>(
        `SELECT COUNT(*)::text AS count FROM payment_transactions pt
         JOIN tenants t ON t.id = pt."tenantId" ${where}`,
        values,
      ),
      this.tenantDatabase.read<
        QueryResultRow & {
          currency: string;
          succeededMinor: string;
          pendingMinor: string;
          failedCount: string;
          transactionCount: string;
        }
      >(`SELECT currency::text AS currency,
          COALESCE(SUM("amountMinor") FILTER (WHERE status::text = 'succeeded'), 0)::text AS "succeededMinor",
          COALESCE(SUM("amountMinor") FILTER (WHERE status::text = 'pending'), 0)::text AS "pendingMinor",
          COUNT(*) FILTER (WHERE status::text = 'failed')::text AS "failedCount",
          COUNT(*)::text AS "transactionCount"
        FROM payment_transactions GROUP BY currency ORDER BY currency`),
    ]);
    const total = Number(count.rows[0]?.count ?? 0);
    return {
      data: rows.rows,
      summaryByCurrency: summary.rows.map((row) => ({
        ...row,
        succeededMinor: Number(row.succeededMinor),
        pendingMinor: Number(row.pendingMinor),
        failedCount: Number(row.failedCount),
        transactionCount: Number(row.transactionCount),
      })),
      pagination: this.pagination(total, query.page, query.pageSize),
    };
  }

  private platformUserSelect() {
    return `
      SELECT u.id, u.name, u.email, u."avatarUrl", u.status::text AS status,
             u."createdAt", u."updatedAt", t.id AS "organizationId",
             t.name AS "organizationName", t."workspaceSlug", r.name AS role,
             d.name AS department, login."lastLoginAt"
      FROM users u
      JOIN tenants t ON t.id = u."tenantId"
      LEFT JOIN roles r ON r.id = u."roleId"
      LEFT JOIN departments d ON d.id = u."departmentId"
      LEFT JOIN LATERAL (
        SELECT MAX(rt."lastUsedAt") AS "lastLoginAt"
        FROM refresh_tokens rt WHERE rt."userId" = u.id
      ) login ON TRUE
    `;
  }

  private mapOrganization(row: OrganizationRow, includeBilling = false) {
    const amountMinor = row.billingAmountMinor ?? 0;
    const monthlyRecurringRevenueMinor =
      row.billingStatus === 'active' || row.billingStatus === 'non_renewing'
        ? row.billingInterval === 'annually'
          ? Math.round(amountMinor / 12)
          : amountMinor
        : 0;
    const mapped = {
      ...row,
      userCount: Number(row.userCount),
      projectCount: Number(row.projectCount),
      enabledModuleCount: Number(row.enabledModuleCount),
      monthlyRecurringRevenueMinor,
      revenueCurrency: row.billingCurrency ?? row.defaultCurrency,
      storageUsage: null,
    };
    if (includeBilling) return mapped;
    return {
      ...mapped,
      planId: null,
      planName: null,
      billingStatus: null,
      billingInterval: null,
      billingAmountMinor: null,
      billingCurrency: null,
      seatCount: null,
      subscriptionRenewsAt: null,
      paidThroughAt: null,
      cancelAtPeriodEnd: false,
      monthlyRecurringRevenueMinor: 0,
    };
  }

  private mapUser(row: PlatformUserRow) {
    return { ...row, mfaEnabled: null };
  }

  private pagination(total: number, page: number, pageSize: number) {
    return {
      page,
      pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
