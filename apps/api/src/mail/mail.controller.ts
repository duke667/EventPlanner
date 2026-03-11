import { Controller, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MailService } from "./mail.service";

@UseGuards(JwtAuthGuard)
@Controller("jobs")
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post("process-email-queue")
  processQueue() {
    return this.mailService.processQueue();
  }
}
