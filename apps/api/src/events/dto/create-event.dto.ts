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

export class CreateEventDto {
  @IsString()
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsString()
  @MaxLength(180)
  locationName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  locationAddress?: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsString()
  @MaxLength(80)
  timezone!: string;

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
