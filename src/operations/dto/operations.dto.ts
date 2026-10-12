import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestBackupDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
