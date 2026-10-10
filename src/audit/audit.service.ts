import { Injectable } from '@nestjs/common';
import { PlatformDatabaseService } from '../database/platform-database.service';
import type { RecordAuditEvent } from './audit.types';

@Injectable()
export class AuditService {
  constructor(private readonly database: PlatformDatabaseService) {}

  record(event: RecordAuditEvent) {
    return this.database.platformAuditEvent.create({
      data: {
        actorId: event.actorId,
        action: event.action,
        outcome: event.outcome ?? 'success',
        targetType: event.targetType,
        targetId: event.targetId,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        metadata: event.metadata ?? {},
      },
    });
  }
}
