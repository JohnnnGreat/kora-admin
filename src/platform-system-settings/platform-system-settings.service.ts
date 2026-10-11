import { Injectable } from '@nestjs/common';
import { PlatformDatabaseService } from '../database/platform-database.service';
import type { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';

const SETTINGS_ID = 'default';

@Injectable()
export class PlatformSystemSettingsService {
  constructor(private readonly database: PlatformDatabaseService) {}

  get() {
    return this.database.platformSystemSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID },
      update: {},
    });
  }

  update(adminId: string, dto: UpdateSystemSettingsDto) {
    return this.database.platformSystemSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...dto, updatedById: adminId },
      update: { ...dto, updatedById: adminId },
    });
  }
}
