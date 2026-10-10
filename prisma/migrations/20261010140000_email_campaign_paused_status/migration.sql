-- Adds "paused" to PlatformEmailCampaignStatus so a campaign's delivery can
-- be paused (and later resumed) without cancelling it outright. Additive
-- only: existing rows and the rest of the enum are untouched.
ALTER TYPE "PlatformEmailCampaignStatus" ADD VALUE 'paused';
