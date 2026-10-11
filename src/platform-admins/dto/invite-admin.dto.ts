import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class InviteAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roleIds!: string[];
}
