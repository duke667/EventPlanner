import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

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

  @IsOptional()
  @IsBoolean()
  companionRequested?: boolean;

  @ValidateIf((dto: RespondInvitationDto) => dto.companionRequested === true)
  @IsString()
  @MaxLength(120)
  companionFirstName?: string;

  @ValidateIf((dto: RespondInvitationDto) => dto.companionRequested === true)
  @IsString()
  @MaxLength(120)
  companionLastName?: string;
}
