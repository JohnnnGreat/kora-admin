import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmailController, EmailEventsController } from './email.controller';
import { EmailService } from './email.service';
import { EmailWorker } from './email.worker';

@Module({
  imports: [AuditModule],
  controllers: [EmailController, EmailEventsController],
  providers: [EmailService, EmailWorker],
})
export class EmailModule {}
