import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CoreApiClient } from './core-api.client';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [AuditModule],
  controllers: [OperationsController],
  providers: [CoreApiClient, OperationsService],
})
export class OperationsModule {}
