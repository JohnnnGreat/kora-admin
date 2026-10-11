import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlatformDatabaseService } from '../database/platform-database.service';
import type { CreateRoleDto, UpdateRoleDto } from './dto/save-role.dto';

@Injectable()
export class PlatformRolesService {
  constructor(private readonly database: PlatformDatabaseService) {}

  async list() {
    const roles = await this.database.platformRole.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { admins: true } } },
    });
    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      isSystem: role.isSystem,
      memberCount: role._count.admins,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    }));
  }

  private async find(id: string) {
    const role = await this.database.platformRole.findUnique({
      where: { id },
    });
    if (!role) throw new NotFoundException('Role not found.');
    return role;
  }

  async create(dto: CreateRoleDto) {
    const existing = await this.database.platformRole.findUnique({
      where: { key: dto.key },
    });
    if (existing)
      throw new ConflictException('A role with this key already exists.');
    return this.database.platformRole.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description ?? '',
        permissions: dto.permissions,
      },
    });
  }

  async update(id: string, dto: UpdateRoleDto) {
    const role = await this.find(id);
    if (role.isSystem)
      throw new BadRequestException('System roles cannot be edited.');
    return this.database.platformRole.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description ?? '',
        permissions: dto.permissions,
      },
    });
  }

  async remove(id: string) {
    const role = await this.find(id);
    if (role.isSystem)
      throw new BadRequestException('System roles cannot be deleted.');
    const memberCount = await this.database.platformAdminRole.count({
      where: { roleId: id },
    });
    if (memberCount > 0)
      throw new BadRequestException(
        'Reassign every member holding this role before deleting it.',
      );
    await this.database.platformRole.delete({ where: { id } });
    return { id };
  }
}
