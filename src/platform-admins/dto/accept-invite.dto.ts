import { IsString, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}
