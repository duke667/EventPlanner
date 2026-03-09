export type InvitationStatus =
  | "draft"
  | "scheduled"
  | "sent"
  | "registered"
  | "declined"
  | "checked_in"
  | "no_show"
  | "cancelled";

export type EventStatus = "draft" | "published" | "closed" | "archived";

export interface EventSummary {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  locationName: string;
  status: EventStatus;
}

