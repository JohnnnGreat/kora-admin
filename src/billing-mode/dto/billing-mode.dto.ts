import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  MaxLength,
} from 'class-validator';

const MODES = ['self', 'platform'] as const;

export class SetDefaultBillingModeDto {
  @IsIn(MODES) defaultMode!: (typeof MODES)[number];
}

export class SetOrganizationBillingModeDto {
  @IsIn(MODES) mode!: (typeof MODES)[number];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class BulkSetBillingModeDto {
  @IsIn(MODES) mode!: (typeof MODES)[number];
  // Omitted entirely = every organization. Given explicitly = just those.
  @IsOptional() @IsString({ each: true }) organizationIds?: string[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class SaveManagedBillingDto {
  @IsString() @Length(1, 200) planName!: string;
  @IsInt() @Min(0) amountMinor!: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional()
  @IsIn(['monthly', 'annually'])
  interval?: 'monthly' | 'annually';
  @IsOptional()
  @IsIn(['active', 'paused', 'cancelled'])
  status?: 'active' | 'paused' | 'cancelled';
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
