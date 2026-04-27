import { Body, Controller, Get, Param, Post, Res } from "@nestjs/common";
import { Response } from "express";
import { RespondInvitationDto } from "./dto/respond-invitation.dto";
import { GuestService } from "./guest.service";

@Controller("guest")
export class GuestController {
  constructor(private readonly guestService: GuestService) {}

  @Get("code/:code")
  resolveInvitationCode(@Param("code") code: string) {
    return this.guestService.resolveInvitationCode(code);
  }

  @Get("invitation/:token")
  getInvitation(@Param("token") token: string) {
    return this.guestService.getInvitation(token);
  }

  @Post("invitation/:token/respond")
  respond(@Param("token") token: string, @Body() dto: RespondInvitationDto) {
    return this.guestService.respond(token, dto);
  }

  @Post("invitation/:token/resend-qr")
  resendQrCode(@Param("token") token: string) {
    return this.guestService.resendQrCode(token);
  }

  @Get("invitation/:token/ics")
  async getCalendarFile(@Param("token") token: string, @Res() response: Response) {
    const calendar = await this.guestService.getCalendarFile(token);

    response.setHeader("Content-Type", "text/calendar; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="event.ics"');
    response.send(calendar);
  }
}
