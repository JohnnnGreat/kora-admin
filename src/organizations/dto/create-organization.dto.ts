import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateOrganizationDto {
  @IsOptional()
  @IsString()
  @Length(16, 100)
  idempotencyKey?: string;

  @IsString()
  @MinLength(2)
  companyName!: string;

  @IsString()
  @MinLength(2)
  ownerName!: string;

  @IsEmail()
  ownerEmail!: string;

  @Length(3, 40)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  workspaceSlug!: string;

  @IsIn(['en', 'fr'])
  language!: string;

  @IsIn(['NG', 'GH', 'KE', 'ZA', 'GB', 'US'])
  country!: string;

  @IsIn([
    'Africa/Lagos',
    'Africa/Accra',
    'Africa/Nairobi',
    'Africa/Johannesburg',
    'Europe/London',
    'America/New_York',
  ])
  timezone!: string;

  @IsIn(['NGN', 'GHS', 'USD', 'GBP', 'EUR', 'ZAR'])
  currency!: string;

  @IsIn(['1-10', '11-50', '51-200', '201+'])
  teamSize!: string;

  @IsIn([
    'consulting',
    'professional_services',
    'energy_and_utilities',
    'technology',
    'non_profit',
    'other',
  ])
  workType!: string;

  @IsIn([
    'spreadsheets',
    'microsoft_365',
    'google_workspace',
    'another_erp',
    'no_formal_system',
  ])
  currentTool!: string;

  @IsBoolean()
  usageDataConsent!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  enabledModules!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  trialDays = 7;
}
