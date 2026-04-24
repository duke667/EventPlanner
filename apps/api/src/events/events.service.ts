import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { ConfigService } from "@nestjs/config";
import { CheckInMethod, EventStatus, InvitationStatus } from "@prisma/client";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
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

type ImportRow = {
  index: number;
  data: Record<string, unknown>;
};

type NormalizedGuest = {
  salutation?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  notes?: string;
  tags: string[];
};

type RowError = {
  row: number;
  message: string;
};

type EventMeta = {
  allowCompanion?: boolean;
};

const EVENT_META_PREFIX = "__event_manager_event_meta__:";
const REGISTRATION_META_PREFIX = "__event_manager_registration_meta__:";
const CHECKIN_META_PREFIX = "__event_manager_checkin_meta__:";

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly guestTokenService: GuestTokenService,
  ) {}

  async findAll() {
    const events = await this.prisma.event.findMany({
      include: {
        _count: {
          select: {
            invitations: true,
          },
        },
      },
      orderBy: [{ startsAt: "asc" }, { title: "asc" }],
    });

    return events.map((event) => this.presentEvent(event));
  }

  async create(dto: CreateEventDto, userId: string) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (startsAt >= endsAt) {
      throw new BadRequestException("Event end must be after start");
    }

    const baseSlug = slugify(dto.title);
    const slug = await this.createUniqueSlug(baseSlug);

    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        slug,
        description: this.encodeEventDescription(dto.description, {
          allowCompanion: dto.allowCompanion === true,
        }),
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

    return this.presentEvent(event);
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

    const existingMeta = this.decodeEventDescription(existing.description).meta;
    const event = await this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title,
        slug,
        description:
          dto.description !== undefined || dto.allowCompanion !== undefined
            ? this.encodeEventDescription(
                dto.description ?? this.decodeEventDescription(existing.description).description,
                {
                  ...existingMeta,
                  allowCompanion:
                    dto.allowCompanion !== undefined
                      ? dto.allowCompanion
                      : existingMeta.allowCompanion,
                },
              )
            : undefined,
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

    return this.presentEvent(event);
  }

  async findAttendees(eventId: string) {
    await this.ensureEventExists(eventId);

    const invitations = await this.prisma.eventInvitation.findMany({
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

    return invitations.map((invitation) => this.presentInvitation(invitation));
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

  async importGuests(eventId: string, file: Express.Multer.File, uploadedByUserId: string) {
    await this.ensureEventExists(eventId);

    if (!file) {
      throw new BadRequestException("No file uploaded");
    }

    const extension = file.originalname.split(".").pop()?.toLowerCase();
    const sourceType = extension === "xlsx" ? "XLSX" : extension === "csv" ? "CSV" : "";

    if (!sourceType) {
      throw new BadRequestException("Only CSV and XLSX files are supported");
    }

    const rows = sourceType === "CSV" ? this.parseCsv(file.buffer) : this.parseXlsx(file.buffer);

    if (rows.length === 0) {
      throw new BadRequestException("The uploaded file contains no rows");
    }

    const errors: RowError[] = [];
    let importedRows = 0;
    let createdContacts = 0;
    let updatedContacts = 0;
    let createdInvitations = 0;
    let skippedInvitations = 0;

    for (const row of rows) {
      try {
        const normalized = this.normalizeGuestRow(row.data, file.originalname);

        const result = await this.prisma.$transaction(async (tx) => {
          const existingContact = await tx.contact.findUnique({
            where: { email: normalized.email },
            select: { id: true, tags: true },
          });

          const contact = existingContact
            ? await tx.contact.update({
                where: { id: existingContact.id },
                data: {
                  salutation: normalized.salutation,
                  firstName: normalized.firstName,
                  lastName: normalized.lastName,
                  phone: normalized.phone,
                  company: normalized.company,
                  jobTitle: normalized.jobTitle,
                  street: normalized.street,
                  postalCode: normalized.postalCode,
                  city: normalized.city,
                  country: normalized.country,
                  notes: normalized.notes,
                  tags: {
                    set: Array.from(new Set([...existingContact.tags, ...normalized.tags])),
                  },
                },
              })
            : await tx.contact.create({
                data: {
                  salutation: normalized.salutation,
                  firstName: normalized.firstName,
                  lastName: normalized.lastName,
                  email: normalized.email,
                  phone: normalized.phone,
                  company: normalized.company,
                  jobTitle: normalized.jobTitle,
                  street: normalized.street,
                  postalCode: normalized.postalCode,
                  city: normalized.city,
                  country: normalized.country,
                  notes: normalized.notes,
                  tags: normalized.tags,
                },
              });

          const existingInvitation = await tx.eventInvitation.findUnique({
            where: {
              eventId_contactId: {
                eventId,
                contactId: contact.id,
              },
            },
            select: { id: true },
          });

          if (existingInvitation) {
            return {
              contactCreated: !existingContact,
              invitationCreated: false,
            };
          }

          const secret =
            this.configService.get<string>("INVITE_TOKEN_SECRET") ?? "change-me-too";
          const inviteToken = randomBytes(24).toString("hex");
          const checkinToken = randomBytes(24).toString("hex");

          await tx.eventInvitation.create({
            data: {
              eventId,
              contactId: contact.id,
              status: InvitationStatus.DRAFT,
              inviteTokenHash: this.hashToken(inviteToken, secret),
              checkinTokenHash: this.hashToken(checkinToken, secret),
            },
          });

          return {
            contactCreated: !existingContact,
            invitationCreated: true,
          };
        });

        importedRows += 1;
        createdContacts += result.contactCreated ? 1 : 0;
        updatedContacts += result.contactCreated ? 0 : 1;
        createdInvitations += result.invitationCreated ? 1 : 0;
        skippedInvitations += result.invitationCreated ? 0 : 1;
      } catch (error) {
        errors.push({
          row: row.index,
          message: error instanceof Error ? error.message : "Unknown import error",
        });
      }
    }

    const record = await this.prisma.contactImport.create({
      data: {
        uploadedByUserId,
        filename: file.originalname,
        sourceType,
        status: errors.length > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
        totalRows: rows.length,
        importedRows,
        errorRows: errors.length,
        mappingJson: {
          salutation: ["Anrede"],
          personalSalutation: ["PersAnrede"],
          firstName: ["Vorname"],
          lastName: ["Name"],
          email: ["Mail-Dienstl1", "Mail-Privat", "E-Mail", "Email"],
          company: ["Firma", "Amt"],
          jobTitle: ["Position"],
          street: ["Straße", "Strasse", "Privat-Str"],
          postalCode: ["PLZ", "Privat-PLZ"],
          city: ["Ort", "Privat-ORT"],
        },
        errorLogJson: {
          errors,
          createdContacts,
          updatedContacts,
          createdInvitations,
          skippedInvitations,
        },
      },
    });

    return {
      id: record.id,
      filename: record.filename,
      sourceType: record.sourceType,
      status: record.status,
      totalRows: record.totalRows,
      importedRows: record.importedRows,
      errorRows: record.errorRows,
      duplicates: skippedInvitations,
      createdAt: record.createdAt.toISOString(),
      createdContacts,
      updatedContacts,
      createdInvitations,
      skippedInvitations,
      errors,
    };
  }

  async queueInvitationEmails(eventId: string, dto: SendInvitationsDto) {
    await this.ensureEventExists(eventId);

    const templateType = dto.templateType ?? "INVITATION";
    const queuedTemplateType = this.encodeTemplateType(templateType, {
      subject: dto.subject?.trim() || undefined,
      body: dto.body?.trim() || undefined,
    });

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
            templateType: {
              startsWith: templateType,
            },
            status: {
              in: ["QUEUED", "SENT"],
            },
          },
        },
      },
    });

    const pending = invitations.filter((invitation) =>
      invitation.emailJobs.every((job) => job.status !== "SENT"),
    );

    if (pending.length === 0) {
      return {
        queued: 0,
        updated: 0,
      };
    }

    let queued = 0;
    let updated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const invitation of pending) {
        const queuedJob = invitation.emailJobs.find((job) => job.status === "QUEUED");

        if (queuedJob) {
          await tx.emailJob.update({
            where: { id: queuedJob.id },
            data: {
              templateType: queuedTemplateType,
            },
          });
          updated += 1;
        } else {
          await tx.emailJob.create({
            data: {
              eventId,
              eventInvitationId: invitation.id,
              templateType: queuedTemplateType,
              status: "QUEUED",
            },
          });
          queued += 1;
        }

        await tx.eventInvitation.update({
          where: { id: invitation.id },
          data: {
            status: InvitationStatus.SCHEDULED,
          },
        });
      }
    });

    return {
      queued,
      updated,
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
        deviceInfo: this.encodeCheckInDeviceInfo(dto.deviceInfo, {
          companionPresent: dto.companionPresent === true,
        }),
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
      checkIn: this.presentCheckIn(checkIn),
      contact: invitation.contact,
    };
  }

  async previewCheckIn(eventId: string, dto: CheckInDto) {
    await this.ensureEventExists(eventId);

    const resolvedInvitationId = this.resolveInvitationId(eventId, dto);
    const invitation = await this.prisma.eventInvitation.findUnique({
      where: { id: resolvedInvitationId },
      include: {
        contact: true,
        registration: true,
        checkIns: {
          orderBy: { checkedInAt: "desc" },
        },
      },
    });

    if (!invitation || invitation.eventId !== eventId) {
      throw new NotFoundException("Invitation not found for event");
    }

    return this.presentInvitation(invitation);
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

  private parseCsv(buffer: Buffer): ImportRow[] {
    const records = parse(buffer, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, unknown>>;

    return records.map((data, index) => ({
      index: index + 2,
      data,
    }));
  }

  private parseXlsx(buffer: Buffer): ImportRow[] {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
      return [];
    }

    const sheet = workbook.Sheets[sheetName];
    const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
    });

    return records.map((data, index) => ({
      index: index + 2,
      data,
    }));
  }

  private normalizeGuestRow(row: Record<string, unknown>, filename: string): NormalizedGuest {
    const get = (...candidates: string[]) => {
      const normalizedCandidates = candidates.map((candidate) =>
        this.normalizeColumnName(candidate),
      );
      const entry = Object.entries(row).find(([key]) =>
        normalizedCandidates.includes(this.normalizeColumnName(key)),
      );

      return this.stringifyCell(entry?.[1]);
    };

    const email = get("Mail-Dienstl1", "Mail-Privat", "E-Mail", "Email").toLowerCase();

    if (!email) {
      throw new Error("email is required");
    }

    const firstName = get("Vorname", "first_name", "firstname") || "";
    const fallbackName = email.split("@")[0] || "Gast";
    const lastName =
      get("Name", "Nachname", "last_name", "lastname") || get("Firma") || fallbackName;
    const company = get("Firma") || get("Amt") || undefined;
    const salutation = get("Anrede") || undefined;
    const personalSalutation = get("PersAnrede") || undefined;
    const street = get("Straße", "Strasse") || get("Privat-Str") || undefined;
    const postalCode = get("PLZ") || get("Privat-PLZ") || undefined;
    const city = get("Ort") || get("Privat-ORT") || undefined;
    const info = get("Info") || undefined;

    const rawFields = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, this.stringifyCell(value)]),
    );

    return {
      salutation: personalSalutation || salutation,
      firstName,
      lastName,
      email,
      phone: get("Telefon", "Phone") || undefined,
      company,
      jobTitle: get("Position", "Titel", "Title") || undefined,
      street,
      postalCode,
      city,
      country: get("Land", "Country") || undefined,
      notes: this.encodeGuestNotes({
        sourceFilename: filename,
        personalSalutation,
        salutation,
        info,
        raw: rawFields,
        fields: {
          dateiname: get("Dateiname") || undefined,
          amt: get("Amt") || undefined,
          position: get("Position") || undefined,
          zusatz: get("Zusatz") || undefined,
          dsgvo1: get("DSGVO-1") || undefined,
          dsgvo2: get("DSGVO-2") || undefined,
          gueltigBis: get("Gueltig_bis") || undefined,
          dienstlicheEmail: get("Mail-Dienstl1") || undefined,
          privateEmail: get("Mail-Privat") || undefined,
        },
      }),
      tags: ["gaesteliste-import"],
    };
  }

  private encodeTemplateType(
    templateType: string,
    payload: { subject?: string; body?: string },
  ) {
    if (!payload.subject && !payload.body) {
      return templateType;
    }

    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${templateType}:${encoded}`;
  }

  private encodeGuestNotes(value: Record<string, unknown>) {
    const encoded = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    return `__event_manager_guest_fields__:${encoded}`;
  }

  private encodeEventDescription(description: string | undefined | null, meta: EventMeta) {
    const encoded = Buffer.from(JSON.stringify(meta), "utf8").toString("base64url");
    return `${EVENT_META_PREFIX}${encoded}\n${description ?? ""}`;
  }

  private decodeEventDescription(description: string | null): {
    description: string | null;
    meta: EventMeta;
  } {
    if (!description?.startsWith(EVENT_META_PREFIX)) {
      return { description, meta: {} };
    }

    const [header, ...body] = description.split("\n");

    try {
      const meta = JSON.parse(
        Buffer.from(header.slice(EVENT_META_PREFIX.length), "base64url").toString("utf8"),
      ) as EventMeta;

      return {
        description: body.join("\n") || null,
        meta,
      };
    } catch {
      return { description, meta: {} };
    }
  }

  private presentEvent<T extends { description: string | null }>(event: T) {
    const decoded = this.decodeEventDescription(event.description);

    return {
      ...event,
      description: decoded.description,
      allowCompanion: decoded.meta.allowCompanion === true,
    };
  }

  private encodeRegistrationMeta(value: Record<string, unknown>) {
    const encoded = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    return `${REGISTRATION_META_PREFIX}${encoded}`;
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

  private presentInvitation<T extends { registration: unknown; checkIns?: unknown[] }>(
    invitation: T,
  ) {
    const registration =
      invitation.registration && typeof invitation.registration === "object"
        ? this.presentRegistration(invitation.registration)
        : invitation.registration;

    return {
      ...invitation,
      registration,
      checkIns: invitation.checkIns?.map((checkIn) => this.presentCheckIn(checkIn)),
    };
  }

  private presentRegistration<T>(registration: T) {
    const typed = registration as T & {
      dietaryRequirements: string | null;
      guestCount: number;
    };
    const decoded = this.decodeRegistrationMeta(typed.dietaryRequirements);

    return {
      ...typed,
      dietaryRequirements: decoded.dietaryRequirements,
      companionRequested: typed.guestCount > 1,
      companionFirstName:
        typeof decoded.meta.companionFirstName === "string"
          ? decoded.meta.companionFirstName
          : null,
      companionLastName:
        typeof decoded.meta.companionLastName === "string"
          ? decoded.meta.companionLastName
          : null,
    };
  }

  private encodeCheckInDeviceInfo(deviceInfo: string | undefined, meta: Record<string, unknown>) {
    const encoded = Buffer.from(JSON.stringify(meta), "utf8").toString("base64url");
    return `${deviceInfo ?? "web-dashboard"} ${CHECKIN_META_PREFIX}${encoded}`;
  }

  private presentCheckIn<T>(checkIn: T) {
    const typed = checkIn as T & { deviceInfo?: string | null };
    const deviceInfo = typed.deviceInfo ?? "";
    const markerIndex = deviceInfo.indexOf(CHECKIN_META_PREFIX);

    if (markerIndex < 0) {
      return {
        ...typed,
        companionPresent: false,
      };
    }

    try {
      const meta = JSON.parse(
        Buffer.from(deviceInfo.slice(markerIndex + CHECKIN_META_PREFIX.length), "base64url").toString(
          "utf8",
        ),
      ) as { companionPresent?: boolean };

      return {
        ...typed,
        deviceInfo: deviceInfo.slice(0, markerIndex).trim() || null,
        companionPresent: meta.companionPresent === true,
      };
    } catch {
      return {
        ...typed,
        companionPresent: false,
      };
    }
  }

  private normalizeColumnName(value: string) {
    return value
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]/g, "");
  }

  private stringifyCell(value: unknown) {
    if (value === null || value === undefined) {
      return "";
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return String(value).trim();
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
