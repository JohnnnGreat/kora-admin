import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
} from 'class-validator';

export class UpdateAdminRolesDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roleIds!: string[];
}

export class UpdateAdminStatusDto {
  @IsIn(['active', 'disabled'])
  status!: 'active' | 'disabled';
}
