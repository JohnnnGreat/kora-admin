CREATE TYPE "PlatformAdminStatus" AS ENUM ('active', 'disabled');
CREATE TYPE "PlatformMfaKind" AS ENUM ('totp');
CREATE TYPE "PlatformAuditOutcome" AS ENUM ('success', 'failure');

CREATE TABLE "platform_admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "PlatformAdminStatus" NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "passwordSetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_admin_roles" (
    "adminId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_admin_roles_pkey" PRIMARY KEY ("adminId", "roleId")
);

CREATE TABLE "platform_sessions" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_mfa_methods" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "kind" "PlatformMfaKind" NOT NULL DEFAULT 'totp',
    "secretEncrypted" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_mfa_methods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_audit_events" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "outcome" "PlatformAuditOutcome" NOT NULL DEFAULT 'success',
    "targetType" TEXT,
    "targetId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");
CREATE UNIQUE INDEX "platform_roles_key_key" ON "platform_roles"("key");
CREATE INDEX "platform_admin_roles_roleId_idx" ON "platform_admin_roles"("roleId");
CREATE UNIQUE INDEX "platform_sessions_tokenHash_key" ON "platform_sessions"("tokenHash");
CREATE INDEX "platform_sessions_adminId_revokedAt_expiresAt_idx" ON "platform_sessions"("adminId", "revokedAt", "expiresAt");
CREATE UNIQUE INDEX "platform_mfa_methods_adminId_kind_key" ON "platform_mfa_methods"("adminId", "kind");
CREATE INDEX "platform_audit_events_actorId_createdAt_idx" ON "platform_audit_events"("actorId", "createdAt");
CREATE INDEX "platform_audit_events_action_createdAt_idx" ON "platform_audit_events"("action", "createdAt");
CREATE INDEX "platform_audit_events_targetType_targetId_createdAt_idx" ON "platform_audit_events"("targetType", "targetId", "createdAt");

ALTER TABLE "platform_admin_roles" ADD CONSTRAINT "platform_admin_roles_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_admin_roles" ADD CONSTRAINT "platform_admin_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "platform_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_mfa_methods" ADD CONSTRAINT "platform_mfa_methods_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
