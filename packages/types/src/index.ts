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

export interface EventRecord {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  locationName: string;
  locationAddress: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  capacity: number | null;
  status: "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";
  allowCompanion?: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    invitations: number;
  };
}

export interface EventInvitationRecord {
  id: string;
  eventId: string;
  contactId: string;
  accessCode?: string | null;
  status:
    | "DRAFT"
    | "SCHEDULED"
    | "SENT"
    | "REGISTERED"
    | "DECLINED"
    | "CHECKED_IN"
    | "NO_SHOW"
    | "CANCELLED";
  invitedAt: string | null;
  openedAt: string | null;
  respondedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  contact: Contact;
  registration: {
    id: string;
    response: "ACCEPTED" | "DECLINED";
    guestCount?: number;
    companionRequested?: boolean;
    companionFirstName?: string | null;
    companionLastName?: string | null;
    registeredAt: string;
  } | null;
  checkIns?: Array<{
    id: string;
    method: "MANUAL" | "QR";
    checkedInAt: string;
    checkedInByUserId: string | null;
    companionPresent?: boolean;
  }>;
  emailJobs: Array<{
    id: string;
    templateType: string;
    status: string;
    sentAt: string | null;
  }>;
  qrToken?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "ADMIN" | "STAFF" | "CHECK_IN";
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface Contact {
  id: string;
  salutation: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  tags: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactImportResult {
  id: string;
  filename: string;
  sourceType: string;
  status: string;
  totalRows: number;
  importedRows: number;
  errorRows: number;
  duplicates: number;
  createdContacts?: number;
  updatedContacts?: number;
  createdInvitations?: number;
  skippedInvitations?: number;
  createdAt: string;
  errors: Array<{
    row: number;
    message: string;
  }>;
}
