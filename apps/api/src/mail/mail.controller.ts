import { Controller, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { MailService } from "./mail.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("jobs")
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post("process-email-queue")
  @Roles("ADMIN", "EVENT_PLANNER", "STAFF")
  processQueue() {
    return this.mailService.processQueue();
  }
}
