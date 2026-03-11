import { ArrayNotEmpty, IsArray, IsString } from "class-validator";

export class CreateInvitationsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  contactIds!: string[];
}
