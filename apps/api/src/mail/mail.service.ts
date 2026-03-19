import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import ical, { ICalCalendarMethod } from "ical-generator";
import nodemailer from "nodemailer";
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
      return { processed: 0 };
    }

    const transporter = nodemailer.createTransport(
      this.configService.get<string>("MAIL_TRANSPORT_URL") ?? "smtp://localhost:1025",
    );

    let processed = 0;

    for (const job of jobs) {
      try {
        if (!job.invitation || !job.event) {
          await this.markFailed(job.id, "Missing event or invitation relation");
          continue;
        }

        const result =
          job.templateType === "CONFIRMATION"
            ? await this.sendConfirmationMail(transporter, job)
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

        if (job.templateType === "INVITATION") {
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
        await this.markFailed(job.id, error instanceof Error ? error.message : "Unknown error");
      }
    }

    return { processed };
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
      description: invitation.event.description ?? undefined,
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
    const token = this.guestTokenService.createInvitationToken(invitation.id);
    const checkInToken = this.guestTokenService.createCheckInToken(
      invitation.eventId,
      invitation.id,
    );
    const guestUrl = `${this.configService.get<string>("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000"}/guest/${token}`;
    const qrAttachment = await this.createQrAttachment(checkInToken);

    return transporter.sendMail({
      from: this.configService.get<string>("MAIL_FROM") ?? "events@example.com",
      to: invitation.contact.email,
      subject: `Einladung: ${invitation.event.title}`,
      text: [
        `Hallo ${invitation.contact.firstName} ${invitation.contact.lastName},`,
        "",
        `du bist zum Event "${invitation.event.title}" eingeladen.`,
        `Ort: ${invitation.event.locationName}`,
        `Start: ${invitation.event.startsAt.toISOString()}`,
        "",
        `Bitte antworte hier: ${guestUrl}`,
        "Am Eventtag kannst du den beigefuegten QR-Code vorzeigen.",
        `Fallback-Code fuer den Check-in: ${checkInToken}`,
      ].join("\n"),
      html: [
        `<p>Hallo ${invitation.contact.firstName} ${invitation.contact.lastName},</p>`,
        `<p>du bist zum Event <strong>${invitation.event.title}</strong> eingeladen.</p>`,
        `<p><strong>Ort:</strong> ${invitation.event.locationName}<br /><strong>Start:</strong> ${invitation.event.startsAt.toISOString()}</p>`,
        `<p><a href="${guestUrl}">Zur Anmeldung</a></p>`,
        `<p><strong>QR-Check-in:</strong><br />Bitte diesen Code am Einlass vorzeigen.</p>`,
        '<p><img src="cid:checkin-qr@eventmanager" alt="QR-Code fuer den Check-in" width="180" height="180" /></p>',
        `<p><strong>Fallback-Code:</strong><br /><code>${checkInToken}</code></p>`,
      ].join(""),
      attachments: [qrAttachment],
    });
  }

  private async sendConfirmationMail(
    transporter: nodemailer.Transporter,
    job: EmailJobWithRelations,
  ) {
    const invitation = await this.prisma.eventInvitation.findUnique({
      where: { id: job.invitation!.id },
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
        `Kalendereintrag: ${calendarUrl}`,
      ].join("\n"),
      html: [
        `<p>Hallo ${invitation.contact.firstName} ${invitation.contact.lastName},</p>`,
        `<p>deine Anmeldung fuer <strong>${invitation.event.title}</strong> wurde bestaetigt.</p>`,
        `<p><a href="${calendarUrl}">ICS herunterladen</a></p>`,
      ].join(""),
      attachments: [
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
}
