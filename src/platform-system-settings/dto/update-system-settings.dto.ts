import { IsBoolean } from 'class-validator';

export class UpdateSystemSettingsDto {
  @IsBoolean()
  multiCurrencyEnabled!: boolean;

  @IsBoolean()
  multiLanguageEnabled!: boolean;

  @IsBoolean()
  customBrandingEnabled!: boolean;

  @IsBoolean()
  whiteLabelEmailEnabled!: boolean;

  @IsBoolean()
  ipAllowlistingEnabled!: boolean;

  @IsBoolean()
  enforceSessionTimeout!: boolean;
}
