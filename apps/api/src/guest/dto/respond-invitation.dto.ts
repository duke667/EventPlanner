import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class RespondInvitationDto {
  @IsIn(["ACCEPTED", "DECLINED"])
  response!: "ACCEPTED" | "DECLINED";

  @IsOptional()
  @IsInt()
  @Min(1)
  guestCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  dietaryRequirements?: string;
}
