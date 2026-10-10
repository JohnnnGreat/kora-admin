import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const tenantStatuses = ['trial', 'active', 'past_due', 'cancelled'] as const;

export class ListOrganizationsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(tenantStatuses)
  status?: (typeof tenantStatuses)[number];

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}
