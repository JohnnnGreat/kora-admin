CREATE TYPE "PlatformEmailCampaignStatus" AS ENUM ('draft', 'sending', 'sent', 'failed');
CREATE TYPE "PlatformEmailDeliveryStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

CREATE TABLE "platform_email_campaigns" (
  "id" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "preheader" TEXT,
  "content" JSONB NOT NULL,
  "audience" JSONB NOT NULL,
  "status" "PlatformEmailCampaignStatus" NOT NULL DEFAULT 'draft',
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "platform_email_campaigns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_email_campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "platform_email_deliveries" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "recipientName" TEXT,
  "recipientUserId" TEXT,
  "status" "PlatformEmailDeliveryStatus" NOT NULL DEFAULT 'pending',
  "providerId" TEXT,
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_email_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_email_deliveries_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "platform_email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "platform_email_campaigns_createdById_createdAt_idx" ON "platform_email_campaigns"("createdById", "createdAt");
CREATE INDEX "platform_email_campaigns_status_createdAt_idx" ON "platform_email_campaigns"("status", "createdAt");
CREATE UNIQUE INDEX "platform_email_deliveries_campaignId_recipientEmail_key" ON "platform_email_deliveries"("campaignId", "recipientEmail");
CREATE INDEX "platform_email_deliveries_campaignId_status_idx" ON "platform_email_deliveries"("campaignId", "status");
