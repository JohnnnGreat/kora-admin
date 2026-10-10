import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { TenantDatabaseService } from '../database/tenant-database.service';

type TotalsRow = QueryResultRow & {
  organizations: string;
  activeOrganizations: string;
  trialOrganizations: string;
  pastDueOrganizations: string;
  cancelledOrganizations: string;
  users: string;
  activeUsers: string;
  invitedUsers: string;
  disabledUsers: string;
  projects: string;
  activeProjects: string;
};

@Injectable()
export class DashboardService {
  constructor(private readonly tenantDatabase: TenantDatabaseService) {}

  async overview(includeBilling = false) {
    const [totals, growth, revenue, attention] = await Promise.all([
      this.tenantDatabase.read<TotalsRow>(`
        SELECT
          (SELECT COUNT(*) FROM tenants)::text AS organizations,
          (SELECT COUNT(*) FROM tenants WHERE "subscriptionStatus"::text = 'active')::text AS "activeOrganizations",
          (SELECT COUNT(*) FROM tenants WHERE "subscriptionStatus"::text = 'trial')::text AS "trialOrganizations",
          (SELECT COUNT(*) FROM tenants WHERE "subscriptionStatus"::text = 'past_due')::text AS "pastDueOrganizations",
          (SELECT COUNT(*) FROM tenants WHERE "subscriptionStatus"::text = 'cancelled')::text AS "cancelledOrganizations",
          (SELECT COUNT(*) FROM users)::text AS users,
          (SELECT COUNT(*) FROM users WHERE status::text = 'active')::text AS "activeUsers",
          (SELECT COUNT(*) FROM users WHERE status::text = 'invited')::text AS "invitedUsers",
          (SELECT COUNT(*) FROM users WHERE status::text = 'disabled')::text AS "disabledUsers",
          (SELECT COUNT(*) FROM projects)::text AS projects,
          (SELECT COUNT(*) FROM projects WHERE "archivedAt" IS NULL AND stage = 'active')::text AS "activeProjects"
      `),
      includeBilling
        ? this.tenantDatabase.read<
            QueryResultRow & {
              month: Date;
              organizationsCreated: string;
              usersCreated: string;
            }
          >(`
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', CURRENT_DATE) - INTERVAL '11 months',
            date_trunc('month', CURRENT_DATE),
            INTERVAL '1 month'
          ) AS month
        )
        SELECT m.month,
          COUNT(DISTINCT t.id)::text AS "organizationsCreated",
          COUNT(DISTINCT u.id)::text AS "usersCreated"
        FROM months m
        LEFT JOIN tenants t ON date_trunc('month', t."createdAt") = m.month
        LEFT JOIN users u ON date_trunc('month', u."createdAt") = m.month
        GROUP BY m.month ORDER BY m.month
          `)
        : Promise.resolve({ rows: [] }),
      this.tenantDatabase.read<
        QueryResultRow & {
          currency: string;
          monthlyRecurringRevenueMinor: string;
          subscriptions: string;
        }
      >(`
        SELECT bs.currency::text AS currency,
          SUM(CASE WHEN bs.interval::text = 'annually'
            THEN ROUND(bs."amountMinor"::numeric / 12)
            ELSE bs."amountMinor" END)::text AS "monthlyRecurringRevenueMinor",
          COUNT(*)::text AS subscriptions
        FROM billing_subscriptions bs
        WHERE bs.status::text IN ('active', 'non_renewing')
        GROUP BY bs.currency ORDER BY bs.currency
      `),
      this.tenantDatabase.read<
        QueryResultRow & {
          id: string;
          name: string;
          workspaceSlug: string | null;
          country: string | null;
          status: string;
          trialEndsAt: Date | null;
          userCount: string;
          lastActivityAt: Date;
        }
      >(`
        SELECT t.id, t.name, t."workspaceSlug", t.country,
          t."subscriptionStatus"::text AS status, t."trialEndsAt",
          COUNT(DISTINCT u.id)::text AS "userCount",
          GREATEST(t."updatedAt", MAX(u."updatedAt"), MAX(p."updatedAt")) AS "lastActivityAt"
        FROM tenants t
        LEFT JOIN users u ON u."tenantId" = t.id
        LEFT JOIN projects p ON p."tenantId" = t.id
        GROUP BY t.id
        HAVING t."subscriptionStatus"::text <> 'active'
          OR GREATEST(t."updatedAt", MAX(u."updatedAt"), MAX(p."updatedAt")) < CURRENT_TIMESTAMP - INTERVAL '30 days'
        ORDER BY
          CASE t."subscriptionStatus"::text WHEN 'past_due' THEN 0 WHEN 'cancelled' THEN 1 WHEN 'trial' THEN 2 ELSE 3 END,
          "lastActivityAt" ASC
        LIMIT 10
      `),
    ]);

    const row = totals.rows[0];
    return {
      access: { billing: includeBilling },
      totals: Object.fromEntries(
        Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)]),
      ),
      growth: growth.rows.map((item) => ({
        ...item,
        organizationsCreated: Number(item.organizationsCreated),
        usersCreated: Number(item.usersCreated),
      })),
      revenueByCurrency: revenue.rows.map((item) => ({
        ...item,
        monthlyRecurringRevenueMinor: Number(item.monthlyRecurringRevenueMinor),
        subscriptions: Number(item.subscriptions),
      })),
      organizationsRequiringAttention: attention.rows.map((item) => ({
        ...item,
        userCount: Number(item.userCount),
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
