import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../email/email.module';
import {
  PlatformAdminInvitesController,
  PlatformAdminsController,
} from './platform-admins.controller';
import { PlatformAdminsService } from './platform-admins.service';

@Module({
  imports: [AuditModule, EmailModule],
  controllers: [PlatformAdminsController, PlatformAdminInvitesController],
  providers: [PlatformAdminsService],
})
export class PlatformAdminsModule {}
