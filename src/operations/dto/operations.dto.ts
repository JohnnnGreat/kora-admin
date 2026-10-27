import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestBackupDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ResolveErrorDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
