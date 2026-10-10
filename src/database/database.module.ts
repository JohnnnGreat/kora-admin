import { Global, Module } from '@nestjs/common';
import { PlatformDatabaseService } from './platform-database.service';
import { TenantDatabaseService } from './tenant-database.service';

@Global()
@Module({
  providers: [PlatformDatabaseService, TenantDatabaseService],
  exports: [PlatformDatabaseService, TenantDatabaseService],
})
export class DatabaseModule {}
