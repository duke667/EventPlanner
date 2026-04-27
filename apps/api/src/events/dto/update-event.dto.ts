import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

const eventStatuses = ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"] as const;

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  guestPageTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  guestPageIntro?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  guestPageInfo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  guestAcceptLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  guestDeclineLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  locationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  locationAddress?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsIn(eventStatuses)
  status?: (typeof eventStatuses)[number];

  @IsOptional()
  @IsBoolean()
  allowCompanion?: boolean;
}
