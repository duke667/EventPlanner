import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { ConfigService } from "@nestjs/config";
import { CheckInMethod, EventStatus, InvitationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { GuestTokenService } from "../guest/guest-token.service";
import { CheckInDto } from "./dto/check-in.dto";
import { CreateEventDto } from "./dto/create-event.dto";
import { CreateInvitationsDto } from "./dto/create-invitations.dto";
import { SendInvitationsDto } from "./dto/send-invitations.dto";
import { UpdateEventDto } from "./dto/update-event.dto";

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly guestTokenService: GuestTokenService,
  ) {}

  async findAll() {
    return this.prisma.event.findMany({
      include: {
        _count: {
          select: {
            invitations: true,
          },
        },
      },
      orderBy: [{ startsAt: "asc" }, { title: "asc" }],
    });
  }

  async create(dto: CreateEventDto, userId: string) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (startsAt >= endsAt) {
      throw new BadRequestException("Event end must be after start");
    }

    const baseSlug = slugify(dto.title);
    const slug = await this.createUniqueSlug(baseSlug);

    return this.prisma.event.create({
      data: {
        title: dto.title,
        slug,
        description: dto.description,
        locationName: dto.locationName,
        locationAddress: dto.locationAddress,
        startsAt,
        endsAt,
        timezone: dto.timezone,
        capacity: dto.capacity,
        status: dto.status ? (dto.status as EventStatus) : EventStatus.DRAFT,
        createdByUserId: userId,
      },
      include: {
        _count: {
          select: {
            invitations: true,
          },
        },
      },
    });
  }

  async update(id: string, dto: UpdateEventDto) {
    const existing = await this.prisma.event.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException("Event not found");
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;

    if (startsAt >= endsAt) {
      throw new BadRequestException("Event end must be after start");
    }

    let slug: string | undefined;
    if (dto.title && dto.title !== existing.title) {
      const baseSlug = slugify(dto.title);
      slug = await this.createUniqueSlug(baseSlug, existing.id);
    }

    return this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title,
        slug,
        description: dto.description,
        locationName: dto.locationName,
        locationAddress: dto.locationAddress,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        timezone: dto.timezone,
        capacity: dto.capacity,
        status: dto.status as EventStatus | undefined,
      },
      include: {
        _count: {
          select: {
            invitations: true,
          },
        },
      },
    });
  }

  async findAttendees(eventId: string) {
    await this.ensureEventExists(eventId);

    return this.prisma.eventInvitation.findMany({
      where: { eventId },
      include: {
        contact: true,
        registration: true,
        checkIns: {
          orderBy: { checkedInAt: "desc" },
        },
        emailJobs: {
          orderBy: { sentAt: "desc" },
        },
      },
      orderBy: [
        { status: "asc" },
        { contact: { lastName: "asc" } },
        { contact: { firstName: "asc" } },
      ],
    });
  }

  async createInvitations(eventId: string, dto: CreateInvitationsDto) {
    await this.ensureEventExists(eventId);

    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: dto.contactIds } },
      select: { id: true },
    });

    if (contacts.length !== dto.contactIds.length) {
      throw new BadRequestException("One or more contacts do not exist");
    }

    const existing = await this.prisma.eventInvitation.findMany({
      where: {
        eventId,
        contactId: { in: dto.contactIds },
      },
      select: { contactId: true },
    });

    const existingIds = new Set(existing.map((item) => item.contactId));
    const toCreate = dto.contactIds.filter((contactId) => !existingIds.has(contactId));

    if (toCreate.length === 0) {
      return {
        created: 0,
        skipped: dto.contactIds.length,
      };
    }

    const secret = this.configService.get<string>("INVITE_TOKEN_SECRET") ?? "change-me-too";

    await this.prisma.$transaction(
      toCreate.map((contactId) => {
        const inviteToken = randomBytes(24).toString("hex");
        const checkinToken = randomBytes(24).toString("hex");

        return this.prisma.eventInvitation.create({
          data: {
            eventId,
            contactId,
            status: InvitationStatus.DRAFT,
            inviteTokenHash: this.hashToken(inviteToken, secret),
            checkinTokenHash: this.hashToken(checkinToken, secret),
          },
        });
      }),
    );

    return {
      created: toCreate.length,
      skipped: dto.contactIds.length - toCreate.length,
    };
  }

  async queueInvitationEmails(eventId: string, dto: SendInvitationsDto) {
    await this.ensureEventExists(eventId);

    const templateType = dto.templateType ?? "INVITATION";

    const invitations = await this.prisma.eventInvitation.findMany({
      where: {
        eventId,
        status: {
          in: [InvitationStatus.DRAFT, InvitationStatus.SCHEDULED],
        },
      },
      include: {
        emailJobs: {
          where: {
            templateType,
            status: {
              in: ["QUEUED", "SENT"],
            },
          },
        },
      },
    });

    const pending = invitations.filter((invitation) => invitation.emailJobs.length === 0);

    if (pending.length === 0) {
      return {
        queued: 0,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      for (const invitation of pending) {
        await tx.emailJob.create({
          data: {
            eventId,
            eventInvitationId: invitation.id,
            templateType,
            status: "QUEUED",
          },
        });

        await tx.eventInvitation.update({
          where: { id: invitation.id },
          data: {
            status: InvitationStatus.SCHEDULED,
          },
        });
      }
    });

    return {
      queued: pending.length,
    };
  }

  async checkIn(eventId: string, dto: CheckInDto, userId: string) {
    await this.ensureEventExists(eventId);

    const resolvedInvitationId = this.resolveInvitationId(eventId, dto);

    const invitation = await this.prisma.eventInvitation.findUnique({
      where: { id: resolvedInvitationId },
      include: {
        contact: true,
      },
    });

    if (!invitation || invitation.eventId !== eventId) {
      throw new NotFoundException("Invitation not found for event");
    }

    const allowedStatuses = new Set<InvitationStatus>([
      InvitationStatus.SENT,
      InvitationStatus.REGISTERED,
      InvitationStatus.CHECKED_IN,
    ]);

    if (!allowedStatuses.has(invitation.status)) {
      throw new BadRequestException("Invitation is not eligible for check-in");
    }

    const checkIn = await this.prisma.checkIn.create({
      data: {
        eventInvitationId: invitation.id,
        method: (dto.method as CheckInMethod | undefined) ?? CheckInMethod.MANUAL,
        checkedInByUserId: userId,
        deviceInfo: dto.deviceInfo,
      },
    });

    await this.prisma.eventInvitation.update({
      where: { id: invitation.id },
      data: {
        status: InvitationStatus.CHECKED_IN,
      },
    });

    return {
      ok: true,
      checkIn,
      contact: invitation.contact,
    };
  }

  getCheckInToken(eventId: string, invitationId: string) {
    return this.guestTokenService.createCheckInToken(eventId, invitationId);
  }

  private async createUniqueSlug(baseSlug: string, excludeId?: string) {
    const normalizedBase = baseSlug || "event";

    for (let counter = 0; counter < 1000; counter += 1) {
      const candidate =
        counter === 0 ? normalizedBase : `${normalizedBase}-${counter + 1}`;

      const existing = await this.prisma.event.findUnique({
        where: { slug: candidate },
      });

      if (!existing || existing.id === excludeId) {
        return candidate;
      }
    }

    throw new ConflictException("Could not generate unique event slug");
  }

  private async ensureEventExists(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });

    if (!event) {
      throw new NotFoundException("Event not found");
    }
  }

  private hashToken(value: string, secret: string) {
    return createHash("sha256").update(`${secret}:${value}`).digest("hex");
  }

  private resolveInvitationId(eventId: string, dto: CheckInDto) {
    if (dto.qrToken) {
      const parsed = this.guestTokenService.verifyCheckInToken(dto.qrToken);

      if (parsed.eventId !== eventId) {
        throw new BadRequestException("QR token does not belong to this event");
      }

      return parsed.invitationId;
    }

    if (!dto.invitationId) {
      throw new BadRequestException("Invitation ID or QR token is required");
    }

    return dto.invitationId;
  }
}
