import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { TenantDatabaseService } from '../database/tenant-database.service';

const number = (value: unknown) => Number(value ?? 0);

@Injectable()
export class InsightsService {
  constructor(private readonly database: TenantDatabaseService) {}

  async platform() {
    const [summary, modules, retention] = await Promise.all([
      this.database.read<QueryResultRow & Record<string, string>>(`
        SELECT
          COALESCE((SELECT AVG(EXTRACT(EPOCH FROM
            (LEAST(COALESCE(rt."revokedAt", rt."lastUsedAt", NOW()), rt."expiresAt") - rt."createdAt")) / 60)
            FROM refresh_tokens rt WHERE rt."createdAt" >= NOW() - INTERVAL '30 days'), 0)::text AS "avgSessionMinutes",
          COALESCE((SELECT COUNT(DISTINCT "userId") FROM audit_logs WHERE "createdAt" >= NOW() - INTERVAL '1 day'), 0)::text AS dau,
          COALESCE((SELECT COUNT(DISTINCT "userId") FROM audit_logs WHERE "createdAt" >= NOW() - INTERVAL '30 days'), 0)::text AS mau,
          (SELECT COUNT(*) FROM tenants WHERE "deletedAt" IS NULL)::text AS tenants,
          (SELECT COUNT(DISTINCT "tenantId") FROM billing_subscriptions WHERE status::text IN ('active', 'non_renewing'))::text AS "paidTenants",
          (SELECT COUNT(*) FROM billing_subscriptions)::text AS subscriptions,
          (SELECT COUNT(*) FROM billing_subscriptions WHERE status::text = 'cancelled')::text AS "cancelledSubscriptions"
      `),
      this.database.read<
        QueryResultRow & {
          name: string;
          organizations: string;
          adoptionPct: string;
        }
      >(`
        SELECT m.name, COUNT(DISTINCT tm."tenantId")::text AS organizations,
          CASE WHEN (SELECT COUNT(*) FROM tenants WHERE "deletedAt" IS NULL) = 0 THEN '0'
            ELSE ROUND(100.0 * COUNT(DISTINCT tm."tenantId") /
              (SELECT COUNT(*) FROM tenants WHERE "deletedAt" IS NULL), 1)::text END AS "adoptionPct"
        FROM modules m
        LEFT JOIN tenant_modules tm ON tm."moduleId" = m.id
        WHERE m."comingSoon" = false
        GROUP BY m.id, m.name, m."sortOrder"
        ORDER BY COUNT(DISTINCT tm."tenantId") DESC, m."sortOrder" ASC
        LIMIT 8
      `),
      this.database.read<
        QueryResultRow & {
          month: Date;
          activeOrganizations: string;
          eligibleOrganizations: string;
        }
      >(`
        WITH months AS (
          SELECT generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '7 months', date_trunc('month', CURRENT_DATE), INTERVAL '1 month') month
        )
        SELECT m.month,
          COUNT(DISTINCT a."tenantId")::text AS "activeOrganizations",
          COUNT(DISTINCT t.id)::text AS "eligibleOrganizations"
        FROM months m
        LEFT JOIN tenants t ON t."createdAt" < m.month + INTERVAL '1 month' AND t."deletedAt" IS NULL
        LEFT JOIN audit_logs a ON a."tenantId" = t.id AND a."createdAt" >= m.month AND a."createdAt" < m.month + INTERVAL '1 month'
        GROUP BY m.month ORDER BY m.month
      `),
    ]);
    const row = summary.rows[0] ?? {};
    const tenants = number(row.tenants);
    const subscriptions = number(row.subscriptions);
    return {
      avgSessionMinutes: Math.round(number(row.avgSessionMinutes) * 10) / 10,
      dauMauPct: number(row.mau)
        ? Math.round((1000 * number(row.dau)) / number(row.mau)) / 10
        : 0,
      trialToPaidPct: tenants
        ? Math.round((1000 * number(row.paidTenants)) / tenants) / 10
        : 0,
      subscriptionChurnPct: subscriptions
        ? Math.round(
            (1000 * number(row.cancelledSubscriptions)) / subscriptions,
          ) / 10
        : 0,
      moduleAdoption: modules.rows.map((item) => ({
        name: item.name,
        organizations: number(item.organizations),
        adoptionPct: number(item.adoptionPct),
      })),
      monthlyActiveOrganizations: retention.rows.map((item) => ({
        month: item.month,
        activeOrganizations: number(item.activeOrganizations),
        eligibleOrganizations: number(item.eligibleOrganizations),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async revenue() {
    const [totals, trend, plans, organizations] = await Promise.all([
      this.database.read<
        QueryResultRow & {
          currency: string;
          mrrMinor: string;
          outstandingMinor: string;
          activeSubscriptions: string;
        }
      >(`
        SELECT currencies.currency,
          COALESCE(SUM(CASE WHEN bs.status::text IN ('active','non_renewing') THEN CASE WHEN bs.interval::text = 'annually' THEN ROUND(bs."amountMinor"::numeric / 12) ELSE bs."amountMinor" END ELSE 0 END), 0)::text AS "mrrMinor",
          COALESCE((SELECT SUM(pt."amountMinor") FROM payment_transactions pt WHERE pt.currency::text = currencies.currency AND pt.status::text = 'pending'), 0)::text AS "outstandingMinor",
          COUNT(*) FILTER (WHERE bs.status::text IN ('active','non_renewing'))::text AS "activeSubscriptions"
        FROM (SELECT DISTINCT currency::text currency FROM billing_subscriptions UNION SELECT DISTINCT currency::text FROM payment_transactions) currencies
        LEFT JOIN billing_subscriptions bs ON bs.currency::text = currencies.currency
        GROUP BY currencies.currency ORDER BY currencies.currency
      `),
      this.database.read<
        QueryResultRow & { month: Date; currency: string; revenueMinor: string }
      >(`
        WITH months AS (SELECT generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '11 months', date_trunc('month', CURRENT_DATE), INTERVAL '1 month') month),
        currencies AS (SELECT DISTINCT currency::text currency FROM payment_transactions)
        SELECT m.month, c.currency, COALESCE(SUM(pt."amountMinor"), 0)::text AS "revenueMinor"
        FROM months m CROSS JOIN currencies c
        LEFT JOIN payment_transactions pt ON pt.currency::text = c.currency AND pt.status::text = 'succeeded' AND pt."paidAt" >= m.month AND pt."paidAt" < m.month + INTERVAL '1 month'
        GROUP BY m.month, c.currency ORDER BY m.month, c.currency
      `),
      this.database.read<
        QueryResultRow & {
          planName: string;
          currency: string;
          mrrMinor: string;
        }
      >(`
        SELECT sp.name AS "planName", bs.currency::text AS currency,
          SUM(CASE WHEN bs.interval::text = 'annually' THEN ROUND(bs."amountMinor"::numeric / 12) ELSE bs."amountMinor" END)::text AS "mrrMinor"
        FROM billing_subscriptions bs JOIN subscription_plans sp ON sp.id = bs."planId"
        WHERE bs.status::text IN ('active','non_renewing')
        GROUP BY sp.name, bs.currency ORDER BY SUM(bs."amountMinor") DESC
      `),
      this.database.read<
        QueryResultRow & {
          organizationId: string;
          organizationName: string;
          currency: string;
          mrrMinor: string;
        }
      >(`
        SELECT t.id AS "organizationId", t.name AS "organizationName", bs.currency::text AS currency,
          (CASE WHEN bs.interval::text = 'annually' THEN ROUND(bs."amountMinor"::numeric / 12) ELSE bs."amountMinor" END)::text AS "mrrMinor"
        FROM billing_subscriptions bs JOIN tenants t ON t.id = bs."tenantId"
        WHERE bs.status::text IN ('active','non_renewing')
        ORDER BY (CASE WHEN bs.interval::text = 'annually' THEN bs."amountMinor" / 12 ELSE bs."amountMinor" END) DESC LIMIT 10
      `),
    ]);
    return {
      totalsByCurrency: totals.rows.map((row) => ({
        currency: row.currency,
        mrrMinor: number(row.mrrMinor),
        arrMinor: number(row.mrrMinor) * 12,
        outstandingMinor: number(row.outstandingMinor),
        activeSubscriptions: number(row.activeSubscriptions),
      })),
      monthlyRevenue: trend.rows.map((row) => ({
        month: row.month,
        currency: row.currency,
        revenueMinor: number(row.revenueMinor),
      })),
      revenueByPlan: plans.rows.map((row) => ({
        planName: row.planName,
        currency: row.currency,
        mrrMinor: number(row.mrrMinor),
      })),
      topOrganizations: organizations.rows.map((row) => ({
        ...row,
        mrrMinor: number(row.mrrMinor),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async usage() {
    const [summary, byOrganization, monthly, countries] = await Promise.all([
      this.database.read<
        QueryResultRow & {
          peakHour: string;
          trackedActions30d: string;
          activeOrganizations30d: string;
          activeUsers30d: string;
        }
      >(`
        SELECT COALESCE((SELECT to_char(date_trunc('hour', "createdAt" AT TIME ZONE 'Africa/Lagos'), 'HH24:00') FROM audit_logs WHERE "createdAt" >= NOW() - INTERVAL '30 days' GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1), '—') AS "peakHour",
          (SELECT COUNT(*) FROM audit_logs WHERE "createdAt" >= NOW() - INTERVAL '30 days')::text AS "trackedActions30d",
          (SELECT COUNT(DISTINCT "tenantId") FROM audit_logs WHERE "createdAt" >= NOW() - INTERVAL '30 days')::text AS "activeOrganizations30d",
          (SELECT COUNT(DISTINCT "userId") FROM audit_logs WHERE "createdAt" >= NOW() - INTERVAL '30 days')::text AS "activeUsers30d"
      `),
      this.database.read<
        QueryResultRow & {
          organizationId: string;
          organizationName: string;
          actions: string;
        }
      >(`
        SELECT t.id AS "organizationId", t.name AS "organizationName", COUNT(a.id)::text actions
        FROM tenants t LEFT JOIN audit_logs a ON a."tenantId" = t.id AND a."createdAt" >= NOW() - INTERVAL '30 days'
        WHERE t."deletedAt" IS NULL GROUP BY t.id, t.name ORDER BY COUNT(a.id) DESC LIMIT 10
      `),
      this.database.read<
        QueryResultRow & { month: Date; actions: string; activeUsers: string }
      >(`
        WITH months AS (SELECT generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '9 months', date_trunc('month', CURRENT_DATE), INTERVAL '1 month') month)
        SELECT m.month, COUNT(a.id)::text actions, COUNT(DISTINCT a."userId")::text AS "activeUsers"
        FROM months m LEFT JOIN audit_logs a ON a."createdAt" >= m.month AND a."createdAt" < m.month + INTERVAL '1 month'
        GROUP BY m.month ORDER BY m.month
      `),
      this.database.read<
        QueryResultRow & { country: string; organizations: string }
      >(`
        SELECT COALESCE(NULLIF(country, ''), 'Not specified') country, COUNT(*)::text organizations
        FROM tenants WHERE "deletedAt" IS NULL GROUP BY 1 ORDER BY COUNT(*) DESC, 1
      `),
    ]);
    const row = summary.rows[0];
    return {
      peakHour: row?.peakHour ?? '—',
      trackedActions30d: number(row?.trackedActions30d),
      activeOrganizations30d: number(row?.activeOrganizations30d),
      activeUsers30d: number(row?.activeUsers30d),
      actionsByOrganization: byOrganization.rows.map((item) => ({
        ...item,
        actions: number(item.actions),
      })),
      activityTrend: monthly.rows.map((item) => ({
        month: item.month,
        actions: number(item.actions),
        activeUsers: number(item.activeUsers),
      })),
      organizationsByCountry: countries.rows.map((item) => ({
        country: item.country,
        organizations: number(item.organizations),
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
