import type { Prisma } from '../generated/prisma/client';

export type AuditContext = {
  actorId?: string;
  ipAddress?: string;
  userAgent?: string;
};

export type RecordAuditEvent = AuditContext & {
  action: string;
  outcome?: 'success' | 'failure';
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
};
