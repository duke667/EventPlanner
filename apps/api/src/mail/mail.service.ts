import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import ical, { ICalCalendarMethod } from "ical-generator";
import nodemailer from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import QRCode from "qrcode";
import { GuestTokenService } from "../guest/guest-token.service";
import { PrismaService } from "../prisma/prisma.service";

type EmailJobWithRelations = Prisma.EmailJobGetPayload<{
  include: {
    event: true;
    invitation: {
      include: {
        event: true;
        contact: true;
      };
    };
  };
}>;

type InvitationWithRelations = Prisma.EventInvitationGetPayload<{
  include: {
    event: true;
    contact: true;
    registration: true;
  };
}>;

type InvitationForTemplate = Prisma.EventInvitationGetPayload<{
  include: {
    event: true;
    contact: true;
  };
}>;

type InvitationTemplatePayload = {
  subject?: string;
  body?: string;
};

type GuestFieldPayload = {
  personalSalutation?: string;
  fields?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

const EVENT_META_PREFIX = "__event_manager_event_meta__:";

@Injectable()
export class MailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly guestTokenService: GuestTokenService,
  ) {}

  async processQueue() {
    const jobs = await this.prisma.emailJob.findMany({
      where: { status: "QUEUED" },
      include: {
        event: true,
        invitation: {
          include: {
            event: true,
            contact: true,
          },
        },
      },
      orderBy: { id: "asc" },
    });

    if (jobs.length === 0) {
      return { processed: 0, failed: 0, errors: [] };
    }

    const transporter = this.createTransporter();

    let processed = 0;
    let failed = 0;
    const errors: Array<{ jobId: string; recipient?: string; message: string }> = [];

    for (const job of jobs) {
      try {
        if (!job.invitation || !job.event) {
          await this.markFailed(job.id, "Missing event or invitation relation");
          continue;
        }

        const result =
          job.templateType === "CONFIRMATION"
            ? await this.sendConfirmationMail(transporter, job.invitation.id)
            : await this.sendInvitationMail(transporter, job);

        await this.prisma.emailJob.update({
          where: { id: job.id },
          data: {
            status: "SENT",
            providerMessageId: result.messageId,
            sentAt: new Date(),
            errorMessage: null,
          },
        });

        if (job.templateType.startsWith("INVITATION")) {
          await this.prisma.eventInvitation.update({
            where: { id: job.invitation.id },
            data: {
              status: "SENT",
              invitedAt: new Date(),
            },
          });
        }

        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        await this.markFailed(job.id, message);
        failed += 1;
        errors.push({
          jobId: job.id,
          recipient: job.invitation?.contact.email,
          message,
        });
      }
    }

    return { processed, failed, errors };
  }

  async sendConfirmationForInvitation(invitationId: string) {
    const transporter = this.createTransporter();
    const job = await this.prisma.emailJob.create({
      data: {
        eventInvitationId: invitationId,
        templateType: "CONFIRMATION",
        status: "QUEUED",
      },
    });

    try {
      const result = await this.sendConfirmationMail(transporter, invitationId);

      await this.prisma.emailJob.update({
        where: { id: job.id },
        data: {
          status: "SENT",
          providerMessageId: result.messageId,
          sentAt: new Date(),
          errorMessage: null,
        },
      });

      return { ok: true };
    } catch (error) {
      await this.markFailed(job.id, error instanceof Error ? error.message : "Unknown error");
      throw error;
    }
  }

  buildCalendarAttachment(invitation: InvitationWithRelations) {
    const calendar = ical({
      name: invitation.event.title,
      method: ICalCalendarMethod.REQUEST,
    });

    calendar.createEvent({
      id: invitation.id,
      start: invitation.event.startsAt,
      end: invitation.event.endsAt,
      summary: invitation.event.title,
      description: this.decodeEventDescription(invitation.event.description) ?? undefined,
      location: invitation.event.locationAddress
        ? `${invitation.event.locationName}, ${invitation.event.locationAddress}`
        : invitation.event.locationName,
      organizer: {
        name: "EventManager",
        email: this.configService.get<string>("MAIL_FROM") ?? "events@example.com",
      },
      attendees: [
        {
          name: `${invitation.contact.firstName} ${invitation.contact.lastName}`,
          email: invitation.contact.email,
          rsvp: true,
        },
      ],
    });

    return calendar.toString();
  }

  async buildInvitationPageContent(
    invitation: InvitationForTemplate,
    templateType?: string,
  ) {
    const accessCode = await this.ensureInvitationAccessCode(
      invitation.id,
      invitation.accessCode,
    );
    const content = this.buildInvitationContent(invitation, templateType, accessCode);
    const body = content.body.trimStart().startsWith(content.salutation)
      ? content.body.trimStart().slice(content.salutation.length).trimStart()
      : content.body;

    return {
      ...content,
      body,
    };
  }

  private async createQrAttachment(payload: string) {
    const dataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 280,
    });

    return {
      cid: "checkin-qr@eventmanager",
      filename: "checkin-qr.png",
      content: this.dataUrlToBuffer(dataUrl),
      contentType: "image/png",
    };
  }

  private dataUrlToBuffer(dataUrl: string) {
    const [, base64] = dataUrl.split(",");

    if (!base64) {
      throw new Error("Invalid QR code payload");
    }

    return Buffer.from(base64, "base64");
  }

  private async sendInvitationMail(
    transporter: nodemailer.Transporter,
    job: EmailJobWithRelations,
  ) {
    const invitation = job.invitation!;
    const accessCode = await this.ensureInvitationAccessCode(
      invitation.id,
      invitation.accessCode,
    );
    const { subject, body, invitationUrl, invitationCode } = this.buildInvitationContent(
      invitation,
      job.templateType,
      accessCode,
    );
    const bodyWithFallback = [
      body,
      "",
      `Persoenlicher Einladungsbereich: ${invitationUrl}`,
      `Code-Eingabe: ${this.getGuestCodeUrl()}`,
      `Einladungscode zum Abtippen: ${this.formatInvitationCode(invitationCode)}`,
    ].join("\n");

    return transporter.sendMail({
      from: this.configService.get<string>("MAIL_FROM") ?? "events@example.com",
      to: invitation.contact.email,
      subject,
      text: bodyWithFallback,
      html: [
        this.textToHtml(body),
        `<p><a href="${this.escapeHtml(invitationUrl)}">Zur Anmeldung</a></p>`,
        `<p><a href="${this.escapeHtml(this.getGuestCodeUrl())}">Einladungscode eingeben</a></p>`,
        `<p><strong>Einladungscode zum Abtippen:</strong><br /><code>${this.escapeHtml(this.formatInvitationCode(invitationCode))}</code></p>`,
      ].join(""),
    });
  }

  private async sendConfirmationMail(
    transporter: nodemailer.Transporter,
    invitationId: string,
  ) {
    const invitation = await this.prisma.eventInvitation.findUnique({
      where: { id: invitationId },
      include: {
        event: true,
        contact: true,
        registration: true,
      },
    });

    if (!invitation) {
      throw new Error("Invitation not found for confirmation mail");
    }

    const token = this.guestTokenService.createInvitationToken(invitation.id);
    const ics = this.buildCalendarAttachment(invitation);
    const checkInToken = this.guestTokenService.createCheckInToken(
      invitation.eventId,
      invitation.id,
    );
    const qrAttachment = await this.createQrAttachment(checkInToken);
    const calendarUrl = `${
      this.configService.get<string>("NEXT_PUBLIC_API_URL") ?? "http://localhost:4000"
    }/api/guest/invitation/${token}/ics`;

    return transporter.sendMail({
      from: this.configService.get<string>("MAIL_FROM") ?? "events@example.com",
      to: invitation.contact.email,
      subject: `Bestaetigung: ${invitation.event.title}`,
      text: [
        `Hallo ${invitation.contact.firstName} ${invitation.contact.lastName},`,
        "",
        `deine Anmeldung fuer "${invitation.event.title}" wurde bestaetigt.`,
        "Deinen QR-Code fuer den Einlass findest du im Anhang dieser E-Mail.",
        `Fallback-Code fuer den Check-in: ${checkInToken}`,
        `Kalendereintrag: ${calendarUrl}`,
      ].join("\n"),
      html: [
        `<p>Hallo ${invitation.contact.firstName} ${invitation.contact.lastName},</p>`,
        `<p>deine Anmeldung fuer <strong>${invitation.event.title}</strong> wurde bestaetigt.</p>`,
        `<p><strong>QR-Check-in:</strong><br />Bitte diesen Code am Einlass vorzeigen.</p>`,
        '<p><img src="cid:checkin-qr@eventmanager" alt="QR-Code fuer den Check-in" width="180" height="180" /></p>',
        `<p><strong>Fallback-Code:</strong><br /><code>${this.escapeHtml(checkInToken)}</code></p>`,
        `<p><a href="${calendarUrl}">ICS herunterladen</a></p>`,
      ].join(""),
      attachments: [
        qrAttachment,
        {
          filename: "event.ics",
          content: ics,
          contentType: "text/calendar; charset=utf-8",
        },
      ],
    });
  }

  private async markFailed(jobId: string, message: string) {
    await this.prisma.emailJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: message,
      },
    });
  }

  private createTransporter() {
    const transportUrl =
      this.configService.get<string>("MAIL_TRANSPORT_URL") ?? "smtp://localhost:1025";
    const rejectUnauthorized = this.parseBooleanConfig(
      this.configService.get<string>("MAIL_TLS_REJECT_UNAUTHORIZED"),
      true,
    );
    const connectionTimeout = this.parseNumberConfig(
      this.configService.get<string>("MAIL_CONNECTION_TIMEOUT_MS"),
      10000,
    );
    const greetingTimeout = this.parseNumberConfig(
      this.configService.get<string>("MAIL_GREETING_TIMEOUT_MS"),
      10000,
    );
    const socketTimeout = this.parseNumberConfig(
      this.configService.get<string>("MAIL_SOCKET_TIMEOUT_MS"),
      20000,
    );

    const options: SMTPTransport.Options = {
      url: transportUrl,
      connectionTimeout,
      greetingTimeout,
      socketTimeout,
      tls: {
        rejectUnauthorized,
      },
    };

    return nodemailer.createTransport(options);
  }

  private parseBooleanConfig(value: string | undefined, defaultValue: boolean) {
    if (value === undefined) {
      return defaultValue;
    }

    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }

    return defaultValue;
  }

  private parseNumberConfig(value: string | undefined, defaultValue: number) {
    if (value === undefined) {
      return defaultValue;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  }

  private readTemplatePayload(templateType: string): InvitationTemplatePayload {
    const [, encoded] = templateType.split(":", 2);

    if (!encoded) {
      return {};
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as InvitationTemplatePayload;

      return {
        subject: typeof parsed.subject === "string" ? parsed.subject : undefined,
        body: typeof parsed.body === "string" ? parsed.body : undefined,
      };
    } catch {
      return {};
    }
  }

  private buildInvitationContent(
    invitation: InvitationForTemplate,
    templateType: string | undefined,
    invitationCode: string,
  ) {
    const token = this.guestTokenService.createInvitationToken(invitation.id);
    const invitationUrl = `${this.configService.get<string>("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000"}/guest/${token}`;
    const invitationCodeUrl = this.getGuestCodeUrl();
    const payload = this.readTemplatePayload(templateType ?? "INVITATION");
    const values = this.buildTemplateValues(
      invitation,
      invitationUrl,
      "",
      invitationCode,
      invitationCodeUrl,
    );
    const subject = this.renderTemplate(
      payload.subject || "Einladung: {{event.title}}",
      values,
    );
    const body = this.renderTemplate(
      payload.body ||
        [
          "{{contact.personalSalutation}}",
          "",
          "Sie sind zum Event \"{{event.title}}\" eingeladen.",
          "Ort: {{event.locationName}}",
          "Start: {{event.startsAt}}",
          "",
          "Bitte antworten Sie hier: {{invitationUrl}}",
        ].join("\n"),
      values,
    );

    return {
      subject,
      body,
      salutation: values["contact.personalSalutation"],
      invitationUrl,
      invitationCodeUrl,
      invitationCode,
    };
  }

  private buildTemplateValues(
    invitation: InvitationForTemplate,
    invitationUrl: string,
    checkInToken: string,
    invitationCode = "",
    invitationCodeUrl = "",
  ) {
    const guestFields = this.readGuestFields(invitation.contact.notes);
    const contactCustomFields = this.flattenCustomFields(guestFields);

    return {
      "contact.salutation": invitation.contact.salutation ?? "",
      "contact.personalSalutation":
        guestFields.personalSalutation ||
        invitation.contact.salutation ||
        `Hallo ${invitation.contact.firstName} ${invitation.contact.lastName},`,
      "contact.firstName": invitation.contact.firstName,
      "contact.lastName": invitation.contact.lastName,
      "contact.email": invitation.contact.email,
      "contact.phone": invitation.contact.phone ?? "",
      "contact.company": invitation.contact.company ?? "",
      "contact.jobTitle": invitation.contact.jobTitle ?? "",
      "contact.street": invitation.contact.street ?? "",
      "contact.postalCode": invitation.contact.postalCode ?? "",
      "contact.city": invitation.contact.city ?? "",
      "contact.country": invitation.contact.country ?? "",
      "contact.notes": invitation.contact.notes ?? "",
      "event.title": invitation.event.title,
      "event.description": this.decodeEventDescription(invitation.event.description) ?? "",
      "event.locationName": invitation.event.locationName,
      "event.locationAddress": invitation.event.locationAddress ?? "",
      "event.startsAt": invitation.event.startsAt.toLocaleString("de-DE", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: invitation.event.timezone,
      }),
      "event.endsAt": invitation.event.endsAt.toLocaleString("de-DE", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: invitation.event.timezone,
      }),
      invitationUrl,
      invitationCodeUrl,
      invitationCode,
      checkInToken,
      ...contactCustomFields,
    };
  }

  private async ensureInvitationAccessCode(invitationId: string, currentCode?: string | null) {
    if (currentCode) {
      return currentCode;
    }

    const accessCode = await this.createUniqueAccessCode();
    await this.prisma.eventInvitation.update({
      where: { id: invitationId },
      data: { accessCode },
    });

    return accessCode;
  }

  private async createUniqueAccessCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const bytes = randomBytes(8);
      const code = Array.from(bytes)
        .map((byte) => alphabet[byte % alphabet.length])
        .join("")
        .slice(0, 8);
      const existing = await this.prisma.eventInvitation.findUnique({
        where: { accessCode: code },
        select: { id: true },
      });

      if (!existing) {
        return code;
      }
    }

    throw new Error("Could not generate invitation access code");
  }

  private formatInvitationCode(value: string) {
    return value.length > 4 ? `${value.slice(0, 4)}-${value.slice(4)}` : value;
  }

  private getGuestCodeUrl() {
    return `${this.configService.get<string>("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000"}/guest`;
  }

  private readGuestFields(notes: string | null): GuestFieldPayload {
    const prefix = "__event_manager_guest_fields__:";

    if (!notes?.startsWith(prefix)) {
      return {};
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(notes.slice(prefix.length), "base64url").toString("utf8"),
      ) as GuestFieldPayload;

      return parsed;
    } catch {
      return {};
    }
  }

  private decodeEventDescription(description: string | null) {
    if (!description?.startsWith(EVENT_META_PREFIX)) {
      return description;
    }

    const [, ...body] = description.split("\n");
    return body.join("\n") || null;
  }

  private flattenCustomFields(value: GuestFieldPayload) {
    const result: Record<string, string> = {};
    const fields = value.fields;
    const raw = value.raw;

    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
      for (const [key, fieldValue] of Object.entries(fields)) {
        result[`custom.${key}`] = this.stringifyTemplateValue(fieldValue);
      }
    }

    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [key, fieldValue] of Object.entries(raw)) {
        result[`excel.${key}`] = this.stringifyTemplateValue(fieldValue);
      }
    }

    return result;
  }

  private renderTemplate(template: string, values: Record<string, string>) {
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) => {
      const normalizedKey = key.trim();
      return values[normalizedKey] ?? "";
    });
  }

  private stringifyTemplateValue(value: unknown) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  }

  private textToHtml(value: string) {
    return value
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${this.formatHtmlParagraph(paragraph.trim())}</p>`)
      .join("");
  }

  private formatHtmlParagraph(value: string) {
    return this.escapeHtml(value)
      .replace(
        /https?:\/\/[^\s<]+/g,
        (url) => `<a href="${url}">${this.describeLink(url)}</a>`,
      )
      .replace(/\n/g, "<br />");
  }

  private describeLink(url: string) {
    if (url.includes("/guest/")) {
      return "Zur Anmeldung";
    }

    if (url.includes("/guest")) {
      return "Einladungscode eingeben";
    }

    return "Link oeffnen";
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
