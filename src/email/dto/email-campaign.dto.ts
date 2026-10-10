import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class EmailAudienceDto {
  @IsOptional() @IsArray() @IsEmail({}, { each: true }) directEmails?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) userIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) organizationIds?: string[];
  @IsOptional() @IsIn(['active', 'invited', 'disabled']) userStatus?: string;
  @IsOptional()
  @IsIn(['active', 'trial', 'past_due', 'cancelled'])
  organizationStatus?: string;
  @IsOptional() @IsString() @MaxLength(120) organizationName?: string;
  @IsOptional() @IsString() @MaxLength(120) role?: string;
  @IsOptional() @IsString() @MaxLength(120) department?: string;
}

export class SaveEmailCampaignDto {
  @IsString() @MaxLength(200) subject!: string;
  @IsOptional() @IsString() @MaxLength(500) preheader?: string;
  @IsObject() content!: Record<string, unknown>;
  @ValidateNested() @Type(() => EmailAudienceDto) audience!: EmailAudienceDto;
}

export class ScheduleEmailCampaignDto {
  @IsISO8601() scheduledAt!: string;
}

export class EmailTemplateDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(200) subject!: string;
  @IsOptional() @IsString() @MaxLength(500) preheader?: string;
  @IsObject() content!: Record<string, unknown>;
}

export class UnsubscribeDto {
  @IsEmail() email!: string;
  // Only a link this service itself generated (render()'s unsubscribe
  // footer) carries a valid token — see EmailService.unsubscribeToken().
  // Without this, anyone could suppress an arbitrary address.
  @IsString() token!: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
