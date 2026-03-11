import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "crypto";

@Injectable()
export class GuestTokenService {
  constructor(private readonly configService: ConfigService) {}

  createInvitationToken(invitationId: string) {
    return this.createSignedToken({ invitationId });
  }

  createCheckInToken(eventId: string, invitationId: string) {
    return this.createSignedToken({ eventId, invitationId, type: "checkin" });
  }

  verifyInvitationToken(token: string) {
    const parsed = this.verifySignedToken(token) as { invitationId: string };
    return parsed.invitationId;
  }

  verifyCheckInToken(token: string) {
    const parsed = this.verifySignedToken(token) as {
      eventId: string;
      invitationId: string;
      type: string;
    };

    if (parsed.type !== "checkin") {
      throw new UnauthorizedException("Invalid check-in token");
    }

    return {
      eventId: parsed.eventId,
      invitationId: parsed.invitationId,
    };
  }

  private createSignedToken(payload: Record<string, string>) {
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    const signature = this.sign(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  private verifySignedToken(token: string) {
    const [payload, signature] = token.split(".");

    if (!payload || !signature) {
      throw new UnauthorizedException("Invalid invitation token");
    }

    const expectedSignature = this.sign(payload);
    const actual = Buffer.from(signature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");

    if (actual.length !== expected.length) {
      throw new UnauthorizedException("Invalid invitation token");
    }

    const valid = timingSafeEqual(actual, expected);

    if (!valid) {
      throw new UnauthorizedException("Invalid invitation token");
    }

    try {
      return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
        string,
        string
      >;
    } catch {
      throw new UnauthorizedException("Invalid invitation token");
    }
  }

  private sign(payload: string) {
    const secret = this.configService.get<string>("INVITE_TOKEN_SECRET") ?? "change-me-too";
    return createHmac("sha256", secret).update(payload).digest("base64url");
  }
}
