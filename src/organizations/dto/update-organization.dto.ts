import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateOrganizationDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional()
  @Length(3, 40)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  workspaceSlug?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() defaultCurrency?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) website?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000) userLimit?: number;
}
