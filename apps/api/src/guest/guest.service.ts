import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InvitationStatus, RegistrationResponse } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { RespondInvitationDto } from "./dto/respond-invitation.dto";
import { GuestTokenService } from "./guest-token.service";

const EVENT_META_PREFIX = "__event_manager_event_meta__:";
const REGISTRATION_META_PREFIX = "__event_manager_registration_meta__:";

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
        description: this.decodeEventDescription(invitation.event.description).description,
        locationName: invitation.event.locationName,
        locationAddress: invitation.event.locationAddress,
        startsAt: invitation.event.startsAt,
        endsAt: invitation.event.endsAt,
        timezone: invitation.event.timezone,
        allowCompanion:
          invitation.event.allowCompanion === true ||
          this.decodeEventDescription(invitation.event.description).meta.allowCompanion === true,
      },
      registration: invitation.registration
        ? this.presentRegistration(invitation.registration)
        : null,
    };
  }

  async respond(token: string, dto: RespondInvitationDto) {
    const invitation = await this.findInvitationByToken(token);
    const response = dto.response as RegistrationResponse;
    const eventMeta = this.decodeEventDescription(invitation.event.description).meta;
    const allowCompanion =
      invitation.event.allowCompanion === true || eventMeta.allowCompanion === true;
    const companionRequested =
      response === RegistrationResponse.ACCEPTED &&
      allowCompanion &&
      dto.companionRequested === true;
    const wasAccepted =
      invitation.registration?.response === RegistrationResponse.ACCEPTED &&
      invitation.status === InvitationStatus.REGISTERED;

    const registration = await this.prisma.eventRegistration.upsert({
      where: {
        eventInvitationId: invitation.id,
      },
      update: {
        response,
        guestCount: companionRequested ? 2 : 1,
        comment: dto.comment,
        dietaryRequirements: dto.dietaryRequirements,
        companionRequested,
        companionFirstName: companionRequested ? dto.companionFirstName : null,
        companionLastName: companionRequested ? dto.companionLastName : null,
        registeredAt: new Date(),
        cancelledAt: response === RegistrationResponse.DECLINED ? new Date() : null,
      },
      create: {
        eventInvitationId: invitation.id,
        response,
        guestCount: companionRequested ? 2 : 1,
        comment: dto.comment,
        dietaryRequirements: dto.dietaryRequirements,
        companionRequested,
        companionFirstName: companionRequested ? dto.companionFirstName : null,
        companionLastName: companionRequested ? dto.companionLastName : null,
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

    if (
      response === RegistrationResponse.ACCEPTED &&
      !wasAccepted &&
      (await this.shouldQueueConfirmation(invitation.id))
    ) {
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
      registration: this.presentRegistration(registration),
    };
  }

  async getCalendarFile(token: string) {
    const invitation = await this.findInvitationByToken(token);
    return this.mailService.buildCalendarAttachment(invitation);
  }

  async resendQrCode(token: string) {
    const invitation = await this.findInvitationByToken(token);

    if (
      invitation.status !== InvitationStatus.REGISTERED &&
      invitation.status !== InvitationStatus.CHECKED_IN
    ) {
      throw new BadRequestException("QR-Code kann erst nach einer Zusage versendet werden");
    }

    await this.mailService.sendConfirmationForInvitation(invitation.id);

    return { ok: true };
  }

  async createGuestLink(invitationId: string) {
    const token = this.guestTokenService.createInvitationToken(invitationId);
    return `${token}`;
  }

  private async shouldQueueConfirmation(invitationId: string) {
    const existingConfirmationJob = await this.prisma.emailJob.findFirst({
      where: {
        eventInvitationId: invitationId,
        templateType: "CONFIRMATION",
        status: {
          in: ["QUEUED", "SENT"],
        },
      },
      select: {
        id: true,
      },
    });

    return !existingConfirmationJob;
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

  private decodeEventDescription(description: string | null): {
    description: string | null;
    meta: { allowCompanion?: boolean };
  } {
    if (!description?.startsWith(EVENT_META_PREFIX)) {
      return { description, meta: {} };
    }

    const [header, ...body] = description.split("\n");

    try {
      const meta = JSON.parse(
        Buffer.from(header.slice(EVENT_META_PREFIX.length), "base64url").toString("utf8"),
      ) as { allowCompanion?: boolean };

      return {
        description: body.join("\n") || null,
        meta,
      };
    } catch {
      return { description, meta: {} };
    }
  }

  private decodeRegistrationMeta(value: string | null) {
    if (!value?.startsWith(REGISTRATION_META_PREFIX)) {
      return { dietaryRequirements: value, meta: {} as Record<string, unknown> };
    }

    try {
      const meta = JSON.parse(
        Buffer.from(value.slice(REGISTRATION_META_PREFIX.length), "base64url").toString("utf8"),
      ) as Record<string, unknown>;

      return {
        dietaryRequirements:
          typeof meta.dietaryRequirements === "string" ? meta.dietaryRequirements : null,
        meta,
      };
    } catch {
      return { dietaryRequirements: value, meta: {} as Record<string, unknown> };
    }
  }

  private presentRegistration<
    T extends {
      dietaryRequirements: string | null;
      guestCount: number;
      companionRequested?: boolean;
      companionFirstName?: string | null;
      companionLastName?: string | null;
    },
  >(registration: T) {
    const decoded = this.decodeRegistrationMeta(registration.dietaryRequirements);
    const legacyCompanionRequested = registration.guestCount > 1;

    return {
      ...registration,
      dietaryRequirements: decoded.dietaryRequirements,
      companionRequested:
        registration.companionRequested === true || legacyCompanionRequested,
      companionFirstName:
        registration.companionFirstName ??
        (typeof decoded.meta.companionFirstName === "string"
          ? decoded.meta.companionFirstName
          : null),
      companionLastName:
        registration.companionLastName ??
        (typeof decoded.meta.companionLastName === "string"
          ? decoded.meta.companionLastName
          : null),
    };
  }
}
