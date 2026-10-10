-- Billing mode: who manages an organization's billing (the organization
-- itself, the default today, or the platform centrally). Additive only —
-- three new tables, one new enum, two new back-relations on platform_admins
-- that need no column changes there (the FK lives on the new tables).

CREATE TYPE "PlatformBillingMode" AS ENUM ('self', 'platform');

CREATE TABLE "platform_organization_billing_modes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "PlatformBillingMode" NOT NULL,
    "note" TEXT,
    "setById" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_organization_billing_modes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_organization_billing_modes_organizationId_key" ON "platform_organization_billing_modes"("organizationId");
CREATE INDEX "platform_organization_billing_modes_organizationId_idx" ON "platform_organization_billing_modes"("organizationId");

ALTER TABLE "platform_organization_billing_modes" ADD CONSTRAINT "platform_organization_billing_modes_setById_fkey" FOREIGN KEY ("setById") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "platform_managed_billing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "interval" TEXT NOT NULL DEFAULT 'monthly',
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_managed_billing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_managed_billing_organizationId_key" ON "platform_managed_billing"("organizationId");
CREATE INDEX "platform_managed_billing_organizationId_idx" ON "platform_managed_billing"("organizationId");

ALTER TABLE "platform_managed_billing" ADD CONSTRAINT "platform_managed_billing_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "platform_billing_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "defaultMode" "PlatformBillingMode" NOT NULL DEFAULT 'self',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_billing_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "platform_billing_settings" ADD CONSTRAINT "platform_billing_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
