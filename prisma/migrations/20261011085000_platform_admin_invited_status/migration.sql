-- Adds "invited" to PlatformAdminStatus, ahead of the admin-invite flow
-- migration that follows. Kept in its own transaction, same reason as
-- 20261010140000_email_campaign_paused_status: Postgres won't let a new
-- enum value be used in the same transaction that adds it.
ALTER TYPE "PlatformAdminStatus" ADD VALUE 'invited';
