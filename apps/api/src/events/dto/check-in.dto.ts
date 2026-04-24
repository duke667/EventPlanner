import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class CheckInDto {
  @IsOptional()
  @IsString()
  invitationId?: string;

  @IsOptional()
  @IsString()
  qrToken?: string;

  @IsOptional()
  @IsIn(["MANUAL", "QR"])
  method?: "MANUAL" | "QR";

  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceInfo?: string;

  @IsOptional()
  @IsBoolean()
  companionPresent?: boolean;
}
