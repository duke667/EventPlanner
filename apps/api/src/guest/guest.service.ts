import { Injectable, NotFoundException } from "@nestjs/common";
import { InvitationStatus, RegistrationResponse } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { RespondInvitationDto } from "./dto/respond-invitation.dto";
import { GuestTokenService } from "./guest-token.service";

@Injectable()
export class GuestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guestTokenService: GuestTokenService,
    private readonly mailService: MailService,
  ) {}

  async getInvitation(token: string) {
    const invitation = await this.findInvitationByToken(token);

    return {
      id: invitation.id,
      status: invitation.status,
      contact: {
        firstName: invitation.contact.firstName,
        lastName: invitation.contact.lastName,
        email: invitation.contact.email,
        company: invitation.contact.company,
      },
      event: {
        title: invitation.event.title,
        description: invitation.event.description,
        locationName: invitation.event.locationName,
        locationAddress: invitation.event.locationAddress,
        startsAt: invitation.event.startsAt,
        endsAt: invitation.event.endsAt,
        timezone: invitation.event.timezone,
      },
      registration: invitation.registration,
    };
  }

  async respond(token: string, dto: RespondInvitationDto) {
    const invitation = await this.findInvitationByToken(token);
    const response = dto.response as RegistrationResponse;

    const registration = await this.prisma.eventRegistration.upsert({
      where: {
        eventInvitationId: invitation.id,
      },
      update: {
        response,
        guestCount: dto.guestCount ?? 1,
        comment: dto.comment,
        dietaryRequirements: dto.dietaryRequirements,
        registeredAt: new Date(),
        cancelledAt: response === RegistrationResponse.DECLINED ? new Date() : null,
      },
      create: {
        eventInvitationId: invitation.id,
        response,
        guestCount: dto.guestCount ?? 1,
        comment: dto.comment,
        dietaryRequirements: dto.dietaryRequirements,
        cancelledAt: response === RegistrationResponse.DECLINED ? new Date() : null,
      },
    });

    await this.prisma.eventInvitation.update({
      where: { id: invitation.id },
      data: {
        status:
          response === RegistrationResponse.ACCEPTED
            ? InvitationStatus.REGISTERED
            : InvitationStatus.DECLINED,
        respondedAt: new Date(),
      },
    });

    if (response === RegistrationResponse.ACCEPTED) {
      await this.prisma.emailJob.create({
        data: {
          eventId: invitation.eventId,
          eventInvitationId: invitation.id,
          templateType: "CONFIRMATION",
          status: "QUEUED",
        },
      });
    }

    return {
      ok: true,
      registration,
    };
  }

  async getCalendarFile(token: string) {
    const invitation = await this.findInvitationByToken(token);
    return this.mailService.buildCalendarAttachment(invitation);
  }

  async createGuestLink(invitationId: string) {
    const token = this.guestTokenService.createInvitationToken(invitationId);
    return `${token}`;
  }

  private async findInvitationByToken(token: string) {
    const invitationId = this.guestTokenService.verifyInvitationToken(token);

    const invitation = await this.prisma.eventInvitation.findUnique({
      where: { id: invitationId },
      include: {
        event: true,
        contact: true,
        registration: true,
      },
    });

    if (!invitation) {
      throw new NotFoundException("Invitation not found");
    }

    return invitation;
  }
}
