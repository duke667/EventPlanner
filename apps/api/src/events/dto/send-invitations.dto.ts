import { IsOptional, IsString } from "class-validator";

export class SendInvitationsDto {
  @IsOptional()
  @IsString()
  templateType?: string;
}
