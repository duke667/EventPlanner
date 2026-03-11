import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateEventDto } from "./dto/create-event.dto";
import { CheckInDto } from "./dto/check-in.dto";
import { CreateInvitationsDto } from "./dto/create-invitations.dto";
import { SendInvitationsDto } from "./dto/send-invitations.dto";
import { UpdateEventDto } from "./dto/update-event.dto";
import { EventsService } from "./events.service";

@UseGuards(JwtAuthGuard)
@Controller("events")
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  findAll() {
    return this.eventsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.eventsService.create(dto, user.sub);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateEventDto) {
    return this.eventsService.update(id, dto);
  }

  @Get(":id/attendees")
  findAttendees(@Param("id") id: string) {
    return this.eventsService.findAttendees(id);
  }

  @Post(":id/invitations")
  createInvitations(@Param("id") id: string, @Body() dto: CreateInvitationsDto) {
    return this.eventsService.createInvitations(id, dto);
  }

  @Post(":id/send-invitations")
  sendInvitations(@Param("id") id: string, @Body() dto: SendInvitationsDto) {
    return this.eventsService.queueInvitationEmails(id, dto);
  }

  @Post(":id/check-in")
  checkIn(
    @Param("id") id: string,
    @Body() dto: CheckInDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.checkIn(id, dto, user.sub);
  }
}
