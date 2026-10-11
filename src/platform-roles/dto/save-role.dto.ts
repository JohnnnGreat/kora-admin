import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PLATFORM_PERMISSIONS } from '../../platform-access/platform-permissions';

export class CreateRoleDto {
  // Immutable identifier — lowercase_snake_case, same shape as the seeded
  // "platform_owner" key, never shown to anyone but used in audit events and
  // as the upsert key.
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'key must be lowercase_snake_case, starting with a letter.',
  })
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(PLATFORM_PERMISSIONS, { each: true })
  permissions!: string[];
}

export class UpdateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(PLATFORM_PERMISSIONS, { each: true })
  permissions!: string[];
}
