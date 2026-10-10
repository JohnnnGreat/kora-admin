import { IsOptional, IsString, MaxLength } from 'class-validator';

export class LifecycleActionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
