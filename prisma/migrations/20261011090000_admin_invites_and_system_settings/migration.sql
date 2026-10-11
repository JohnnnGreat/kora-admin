-- passwordHash/passwordSetAt become nullable: an invited admin has neither
-- until they accept.
ALTER TABLE "platform_admins" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "platform_admins" ALTER COLUMN "passwordSetAt" DROP NOT NULL;
ALTER TABLE "platform_admins" ALTER COLUMN "passwordSetAt" DROP DEFAULT;

ALTER TABLE "platform_admins"
  ADD COLUMN "inviteTokenHash" TEXT,
  ADD COLUMN "inviteExpiresAt" TIMESTAMP(3),
  ADD COLUMN "invitedById" TEXT;

CREATE UNIQUE INDEX "platform_admins_inviteTokenHash_key"
  ON "platform_admins"("inviteTokenHash");

ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "platform_admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing admins predate the invite flow entirely — they were created
-- directly (bootstrap script or an earlier manual insert), so they're
-- already fully active, never "invited".
ALTER TABLE "platform_admins" ALTER COLUMN "status" SET DEFAULT 'invited';

CREATE TABLE "platform_system_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "multiCurrencyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "multiLanguageEnabled" BOOLEAN NOT NULL DEFAULT false,
    "customBrandingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whiteLabelEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ipAllowlistingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "enforceSessionTimeout" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_system_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "platform_system_settings"
  ADD CONSTRAINT "platform_system_settings_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "platform_admins"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
