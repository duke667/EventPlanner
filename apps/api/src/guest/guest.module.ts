import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module";
import { GuestController } from "./guest.controller";
import { GuestService } from "./guest.service";
import { GuestTokenService } from "./guest-token.service";

@Module({
  imports: [MailModule],
  controllers: [GuestController],
  providers: [GuestService, GuestTokenService],
  exports: [GuestService, GuestTokenService],
})
export class GuestModule {}
