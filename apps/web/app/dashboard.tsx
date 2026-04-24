"use client";

import Link from "next/link";
import {
  FormEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type {
  Contact,
  ContactImportResult,
  EventInvitationRecord,
  EventRecord,
  LoginResponse,
} from "@event-manager/types";

const STORAGE_KEY = "event-manager-session";
const API_PROXY_BASE = "/backend-api";

const BACKOFFICE_SECTIONS = [
  { id: "overview", label: "Uebersicht", href: "/backoffice" },
  { id: "contacts", label: "Kontakte", href: "/backoffice/contacts" },
  { id: "events", label: "Events", href: "/backoffice/events" },
  { id: "invitations", label: "Einladungen", href: "/backoffice/invitations" },
  { id: "live", label: "Live-Dashboard", href: "/backoffice/live" },
  { id: "checkin", label: "Check-in", href: "/backoffice/checkin" },
] as const;

export type BackofficeSection = (typeof BACKOFFICE_SECTIONS)[number]["id"];
type UserRole = LoginResponse["user"]["role"];
type DetectedBarcode = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorConstructor = new (options: {
  formats: string[];
}) => BarcodeDetectorLike;

type SessionState = LoginResponse | null;

type ContactFormState = {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  tags: string;
};

type EventFormState = {
  title: string;
  description: string;
  locationName: string;
  locationAddress: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  capacity: string;
  status: "DRAFT" | "PUBLISHED";
  allowCompanion: boolean;
};

type InvitationTemplateState = {
  subject: string;
  body: string;
};

const initialContactForm: ContactFormState = {
  firstName: "",
  lastName: "",
  email: "",
  company: "",
  tags: "",
};

const initialEventForm: EventFormState = {
  title: "",
  description: "",
  locationName: "",
  locationAddress: "",
  startsAt: "",
  endsAt: "",
  timezone: "Europe/Berlin",
  capacity: "",
  status: "DRAFT",
  allowCompanion: false,
};

const initialInvitationTemplate: InvitationTemplateState = {
  subject: "Einladung: {{event.title}}",
  body: [
    "{{contact.personalSalutation}}",
    "",
    "wir laden Sie herzlich zu {{event.title}} ein.",
    "",
    "Ort: {{event.locationName}}",
    "Beginn: {{event.startsAt}}",
    "",
    "Bitte geben Sie uns ueber folgenden Link Rueckmeldung:",
    "{{invitationUrl}}",
  ].join("\n"),
};

const TEMPLATE_FIELDS = [
  { token: "contact.personalSalutation", label: "Pers. Anrede" },
  { token: "contact.salutation", label: "Anrede" },
  { token: "contact.firstName", label: "Vorname" },
  { token: "contact.lastName", label: "Nachname" },
  { token: "contact.company", label: "Firma" },
  { token: "contact.jobTitle", label: "Position" },
  { token: "custom.amt", label: "Amt" },
  { token: "custom.zusatz", label: "Zusatz" },
  { token: "event.title", label: "Event" },
  { token: "event.startsAt", label: "Start" },
  { token: "event.locationName", label: "Ort" },
  { token: "invitationUrl", label: "Antwortlink" },
] as const;

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatStatus(status: EventRecord["status"]) {
  switch (status) {
    case "DRAFT":
      return "Entwurf";
    case "PUBLISHED":
      return "Veroeffentlicht";
    case "CLOSED":
      return "Geschlossen";
    case "ARCHIVED":
      return "Archiviert";
    default:
      return status;
  }
}

function formatInvitationStatus(status: EventInvitationRecord["status"]) {
  switch (status) {
    case "DRAFT":
      return "Entwurf";
    case "SCHEDULED":
      return "Zum Versand eingeplant";
    case "SENT":
      return "Versendet";
    case "REGISTERED":
      return "Angemeldet";
    case "DECLINED":
      return "Abgesagt";
    case "CHECKED_IN":
      return "Eingecheckt";
    case "NO_SHOW":
      return "No-Show";
    case "CANCELLED":
      return "Storniert";
    default:
      return status;
  }
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function canManagePlanning(role?: UserRole) {
  return role === "ADMIN" || role === "STAFF";
}

function canCheckIn(role?: UserRole) {
  return role === "ADMIN" || role === "STAFF" || role === "CHECK_IN";
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${API_PROXY_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export function Dashboard({ section = "overview" }: { section?: BackofficeSection }) {
  const [session, setSession] = useState<SessionState>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [attendees, setAttendees] = useState<EventInvitationRecord[]>([]);
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("ChangeMe123!");
  const [query, setQuery] = useState("");
  const [checkInQuery, setCheckInQuery] = useState("");
  const [qrToken, setQrToken] = useState("");
  const [checkInPreview, setCheckInPreview] = useState<EventInvitationRecord | null>(null);
  const [companionPresent, setCompanionPresent] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactForm, setContactForm] =
    useState<ContactFormState>(initialContactForm);
  const [importResult, setImportResult] = useState<ContactImportResult | null>(null);
  const [eventForm, setEventForm] = useState<EventFormState>(initialEventForm);
  const [invitationTemplate, setInvitationTemplate] = useState<InvitationTemplateState>(
    initialInvitationTemplate,
  );
  const [authError, setAuthError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [scannerSupported, setScannerSupported] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isSubmittingContact, startContactTransition] = useTransition();
  const [isImportingContacts, startImportTransition] = useTransition();
  const [isImportingGuests, startGuestImportTransition] = useTransition();
  const [isSubmittingEvent, startEventTransition] = useTransition();
  const [isSubmittingInvitations, startInvitationTransition] = useTransition();
  const deferredQuery = useDeferredValue(query);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const qrStreamRef = useRef<MediaStream | null>(null);
  const qrDetectorRef = useRef<BarcodeDetectorLike | null>(null);
  const qrFrameRef = useRef<number | null>(null);
  const qrBusyRef = useRef(false);
  const currentRole = session?.user.role;
  const visibleSections = BACKOFFICE_SECTIONS.filter((entry) => {
    if (entry.id === "overview") {
      return true;
    }

    if (entry.id === "checkin") {
      return canCheckIn(currentRole);
    }

    return canManagePlanning(currentRole);
  });
  const isSectionAllowed =
    section === "overview" ||
    (section === "checkin" ? canCheckIn(currentRole) : canManagePlanning(currentRole));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const BarcodeDetectorApi = (window as Window & {
      BarcodeDetector?: BarcodeDetectorConstructor;
    }).BarcodeDetector;

    if (!BarcodeDetectorApi) {
      return;
    }

    qrDetectorRef.current = new BarcodeDetectorApi({
      formats: ["qr_code"],
    });
    setScannerSupported(true);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as SessionState;
      setSession(parsed);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    let active = true;
    const planningAccess = canManagePlanning(session.user.role);
    const eventRequest = apiRequest<EventRecord[]>("/events", {}, session.accessToken);
    const contactsRequest = planningAccess
      ? apiRequest<Contact[]>(
          `/contacts${deferredQuery ? `?query=${encodeURIComponent(deferredQuery)}` : ""}`,
          {},
          session.accessToken,
        )
      : Promise.resolve<Contact[]>([]);

    startTransition(() => {
      Promise.all([contactsRequest, eventRequest])
        .then(([contactItems, eventItems]) => {
          if (active) {
            setContacts(contactItems);
            setEvents(eventItems);
            setContactError(null);
            setEventError(null);
          }
        })
        .catch((error: Error) => {
          if (active) {
            setContactError(error.message);
            setEventError(error.message);
          }
        });
    });

    return () => {
      active = false;
    };
  }, [deferredQuery, session]);

  useEffect(() => {
    if (!session?.accessToken || !selectedEventId) {
      setAttendees([]);
      return;
    }

    let active = true;

    startInvitationTransition(() => {
      apiRequest<EventInvitationRecord[]>(
        `/events/${selectedEventId}/attendees`,
        {},
        session.accessToken,
      )
        .then((items) => {
          if (active) {
            setAttendees(items);
            setInvitationError(null);
          }
        })
        .catch((error: Error) => {
          if (active) {
            setInvitationError(error.message);
          }
        });
    });

    return () => {
      active = false;
    };
  }, [selectedEventId, session]);

  useEffect(
    () => () => {
      stopQrScanner();
    },
    [],
  );

  const activeEvent = events.find((event) => event.id === selectedEventId) ?? null;

  const stats = useMemo(
    () => ({
      total: contacts.length,
      companies: new Set(contacts.map((contact) => contact.company).filter(Boolean))
        .size,
      tagged: contacts.filter((contact) => contact.tags.length > 0).length,
    }),
    [contacts],
  );

  const eventStats = useMemo(
    () => ({
      total: events.length,
      published: events.filter((event) => event.status === "PUBLISHED").length,
      draft: events.filter((event) => event.status === "DRAFT").length,
    }),
    [events],
  );

  const invitationStats = useMemo(
    () => ({
      total: attendees.length,
      queued: attendees.filter((invitation) => invitation.status === "SCHEDULED").length,
      registered: attendees.filter((invitation) => invitation.status === "REGISTERED").length,
      checkedIn: attendees.filter((invitation) => invitation.status === "CHECKED_IN").length,
      checkedInPersons: attendees.reduce((total, invitation) => {
        if (invitation.status !== "CHECKED_IN") {
          return total;
        }

        const companionCheckedIn = invitation.checkIns?.[0]?.companionPresent === true;
        return total + 1 + (companionCheckedIn ? 1 : 0);
      }, 0),
    }),
    [attendees],
  );

  const liveStats = useMemo(() => {
    const accepted = attendees.filter((invitation) =>
      ["REGISTERED", "CHECKED_IN"].includes(invitation.status),
    );
    const declined = attendees.filter((invitation) => invitation.status === "DECLINED");
    const checkedIn = attendees.filter((invitation) => invitation.status === "CHECKED_IN");
    const open = attendees.filter((invitation) =>
      ["DRAFT", "SCHEDULED", "SENT"].includes(invitation.status),
    );
    const expectedPersons = accepted.reduce(
      (total, invitation) => total + (invitation.registration?.guestCount ?? 1),
      0,
    );
    const checkedInPersons = checkedIn.reduce((total, invitation) => {
      const companionCheckedIn = invitation.checkIns?.[0]?.companionPresent === true;
      return total + 1 + (companionCheckedIn ? 1 : 0);
    }, 0);
    const companionExpected = accepted.filter(
      (invitation) => invitation.registration?.companionRequested,
    ).length;
    const companionCheckedIn = checkedIn.filter(
      (invitation) => invitation.checkIns?.[0]?.companionPresent,
    ).length;
    const noShows = accepted.filter((invitation) => invitation.status !== "CHECKED_IN");
    const recentCheckIns = checkedIn
      .filter((invitation) => invitation.checkIns?.[0]?.checkedInAt)
      .sort((left, right) =>
        (right.checkIns?.[0]?.checkedInAt ?? "").localeCompare(
          left.checkIns?.[0]?.checkedInAt ?? "",
        ),
      )
      .slice(0, 6);

    return {
      invited: attendees.length,
      accepted: accepted.length,
      declined: declined.length,
      open: open.length,
      checkedIn: checkedIn.length,
      expectedPersons,
      checkedInPersons,
      companionExpected,
      companionCheckedIn,
      noShows,
      recentCheckIns,
      attendanceRate:
        expectedPersons > 0 ? Math.round((checkedInPersons / expectedPersons) * 100) : 0,
      capacityRate:
        activeEvent?.capacity && activeEvent.capacity > 0
          ? Math.round((expectedPersons / activeEvent.capacity) * 100)
          : null,
    };
  }, [activeEvent?.capacity, attendees]);

  const filteredAttendees = useMemo(() => {
    if (!checkInQuery.trim()) {
      return attendees;
    }

    const normalized = checkInQuery.trim().toLowerCase();
    return attendees.filter((invitation) => {
      const haystacks = [
        invitation.contact.firstName,
        invitation.contact.lastName,
        invitation.contact.email,
        invitation.contact.company ?? "",
      ];
      return haystacks.some((value) => value.toLowerCase().includes(normalized));
    });
  }, [attendees, checkInQuery]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);

    startTransition(() => {
      apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      })
        .then((result) => {
          setSession(result);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
        })
        .catch((error: Error) => {
          setAuthError(error.message);
        });
    });
  }

  async function handleCreateContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      return;
    }

    setContactError(null);

    startContactTransition(() => {
      apiRequest<Contact>(
        "/contacts",
        {
          method: "POST",
          body: JSON.stringify({
            firstName: contactForm.firstName,
            lastName: contactForm.lastName,
            email: contactForm.email,
            company: contactForm.company || undefined,
            tags: parseTags(contactForm.tags),
          }),
        },
        session.accessToken,
      )
        .then((created) => {
          setContacts((current) =>
            [created, ...current].sort((left, right) =>
              `${left.lastName}${left.firstName}`.localeCompare(
                `${right.lastName}${right.firstName}`,
                "de",
              ),
            ),
          );
          setContactForm(initialContactForm);
        })
        .catch((error: Error) => {
          setContactError(error.message);
        });
    });
  }

  function handleImportContacts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      return;
    }

    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("contactFile") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];

    if (!file) {
      setContactError("Bitte eine CSV- oder XLSX-Datei auswaehlen.");
      return;
    }

    setContactError(null);
    setImportResult(null);

    startImportTransition(() => {
      const formData = new FormData();
      formData.append("file", file);

      fetch(`${API_PROXY_BASE}/contacts/import`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: formData,
      })
        .then(async (result) => {
          if (!result.ok) {
            const payload = await result.json().catch(() => null);
            throw new Error(payload?.message ?? "Import failed");
          }

          return result.json() as Promise<ContactImportResult>;
        })
        .then((payload) => {
          setImportResult(payload);
          form.reset();
          return apiRequest<Contact[]>(
            `/contacts${deferredQuery ? `?query=${encodeURIComponent(deferredQuery)}` : ""}`,
            {},
            session.accessToken,
          );
        })
        .then((contactItems) => {
          setContacts(contactItems);
        })
        .catch((error: Error) => {
          setContactError(error.message);
        });
    });
  }

  function handleImportGuests(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken || !selectedEventId) {
      return;
    }

    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("guestFile") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];

    if (!file) {
      setInvitationError("Bitte eine CSV- oder XLSX-Datei auswaehlen.");
      return;
    }

    setInvitationError(null);
    setImportResult(null);

    startGuestImportTransition(() => {
      const formData = new FormData();
      formData.append("file", file);

      fetch(`${API_PROXY_BASE}/events/${selectedEventId}/import-guests`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: formData,
      })
        .then(async (result) => {
          if (!result.ok) {
            const payload = await result.json().catch(() => null);
            throw new Error(payload?.message ?? "Guest import failed");
          }

          return result.json() as Promise<ContactImportResult>;
        })
        .then((payload) => {
          setImportResult(payload);
          form.reset();
          return Promise.all([
            apiRequest<Contact[]>(
              `/contacts${deferredQuery ? `?query=${encodeURIComponent(deferredQuery)}` : ""}`,
              {},
              session.accessToken,
            ),
            apiRequest<EventInvitationRecord[]>(
              `/events/${selectedEventId}/attendees`,
              {},
              session.accessToken,
            ),
          ]);
        })
        .then(([contactItems, invitationItems]) => {
          setContacts(contactItems);
          setAttendees(invitationItems);
          setEvents((current) =>
            current.map((event) =>
              event.id === selectedEventId
                ? {
                    ...event,
                    _count: {
                      invitations: invitationItems.length,
                    },
                  }
                : event,
            ),
          );
        })
        .catch((error: Error) => {
          setInvitationError(error.message);
        });
    });
  }

  async function handleCreateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken) {
      return;
    }

    setEventError(null);

    startEventTransition(() => {
      apiRequest<EventRecord>(
        "/events",
        {
          method: "POST",
          body: JSON.stringify({
            title: eventForm.title,
            description: eventForm.description || undefined,
            locationName: eventForm.locationName,
            locationAddress: eventForm.locationAddress || undefined,
            startsAt: new Date(eventForm.startsAt).toISOString(),
            endsAt: new Date(eventForm.endsAt).toISOString(),
            timezone: eventForm.timezone,
            capacity: eventForm.capacity ? Number(eventForm.capacity) : undefined,
            status: eventForm.status,
            allowCompanion: eventForm.allowCompanion,
          }),
        },
        session.accessToken,
      )
        .then((created) => {
          setEvents((current) =>
            [...current, created].sort((left, right) =>
              left.startsAt.localeCompare(right.startsAt),
            ),
          );
          setSelectedEventId(created.id);
          setEventForm(initialEventForm);
        })
        .catch((error: Error) => {
          setEventError(error.message);
        });
    });
  }

  function handleLogout() {
    setSession(null);
    setContacts([]);
    setEvents([]);
    setAttendees([]);
    setSelectedEventId("");
    setSelectedContactIds([]);
    setQuery("");
    window.localStorage.removeItem(STORAGE_KEY);
  }

  function toggleSelectedContact(contactId: string) {
    setSelectedContactIds((current) =>
      current.includes(contactId)
        ? current.filter((id) => id !== contactId)
        : [...current, contactId],
    );
  }

  function handleCreateInvitations() {
    if (!session?.accessToken || !selectedEventId || selectedContactIds.length === 0) {
      return;
    }

    setInvitationError(null);

    startInvitationTransition(() => {
      apiRequest<{ created: number; skipped: number }>(
        `/events/${selectedEventId}/invitations`,
        {
          method: "POST",
          body: JSON.stringify({ contactIds: selectedContactIds }),
        },
        session.accessToken,
      )
        .then(() =>
          apiRequest<EventInvitationRecord[]>(
            `/events/${selectedEventId}/attendees`,
            {},
            session.accessToken,
          ),
        )
        .then((items) => {
          setAttendees(items);
          setSelectedContactIds([]);
          setEvents((current) =>
            current.map((event) =>
              event.id === selectedEventId
                ? {
                    ...event,
                    _count: {
                      invitations: items.length,
                    },
                  }
                : event,
            ),
          );
        })
        .catch((error: Error) => {
          setInvitationError(error.message);
        });
    });
  }

  function handleQueueInvitations() {
    if (!session?.accessToken || !selectedEventId) {
      return;
    }

    setInvitationError(null);

    startInvitationTransition(() => {
      apiRequest<{ queued: number }>(
        `/events/${selectedEventId}/send-invitations`,
        {
          method: "POST",
          body: JSON.stringify({
            templateType: "INVITATION",
            subject: invitationTemplate.subject,
            body: invitationTemplate.body,
          }),
        },
        session.accessToken,
      )
        .then(() =>
          apiRequest<EventInvitationRecord[]>(
            `/events/${selectedEventId}/attendees`,
            {},
            session.accessToken,
          ),
        )
        .then((items) => {
          setAttendees(items);
        })
        .catch((error: Error) => {
          setInvitationError(error.message);
        });
    });
  }

  function insertTemplateField(target: keyof InvitationTemplateState, token: string) {
    setInvitationTemplate((current) => ({
      ...current,
      [target]: `${current[target]}{{${token}}}`,
    }));
  }

  function handleProcessEmailQueue() {
    if (!session?.accessToken) {
      return;
    }

    setInvitationError(null);

    startInvitationTransition(() => {
      apiRequest<{ processed: number }>(
        "/jobs/process-email-queue",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
        session.accessToken,
      )
        .then(() =>
          selectedEventId
            ? apiRequest<EventInvitationRecord[]>(
                `/events/${selectedEventId}/attendees`,
                {},
                session.accessToken,
              )
            : Promise.resolve([]),
        )
        .then((items) => {
          if (selectedEventId) {
            setAttendees(items);
          }
        })
        .catch((error: Error) => {
          setInvitationError(error.message);
        });
    });
  }

  function handleCheckIn(invitationId: string) {
    if (!session?.accessToken || !selectedEventId) {
      return;
    }

    setInvitationError(null);

    startInvitationTransition(() => {
      apiRequest<{ ok: boolean }>(
        `/events/${selectedEventId}/check-in`,
        {
          method: "POST",
          body: JSON.stringify({
            invitationId,
            method: "MANUAL",
            deviceInfo: "web-dashboard",
            companionPresent: false,
          }),
        },
        session.accessToken,
      )
        .then(() =>
          apiRequest<EventInvitationRecord[]>(
            `/events/${selectedEventId}/attendees`,
            {},
            session.accessToken,
          ),
        )
        .then((items) => {
          setAttendees(items);
        })
        .catch((error: Error) => {
          setInvitationError(error.message);
        });
    });
  }

  function handleQrCheckIn() {
    if (!session?.accessToken || !selectedEventId || !qrToken.trim()) {
      return;
    }

    previewQrCheckIn(qrToken.trim());
  }

  function previewQrCheckIn(tokenValue: string) {
    if (!session?.accessToken || !selectedEventId || !tokenValue) {
      return;
    }

    setInvitationError(null);

    startInvitationTransition(() => {
      apiRequest<EventInvitationRecord>(
        `/events/${selectedEventId}/check-in/preview`,
        {
          method: "POST",
          body: JSON.stringify({
            qrToken: tokenValue,
            method: "QR",
          }),
        },
        session.accessToken,
      )
        .then((preview) => {
          setCheckInPreview(preview);
          setCompanionPresent(preview.registration?.companionRequested === true);
        })
        .catch((error: Error) => {
          setInvitationError(error.message);
        });
    });
  }

  function submitQrCheckIn(tokenValue: string) {
    if (!session?.accessToken || !selectedEventId || !tokenValue) {
      return;
    }

    setInvitationError(null);

    startInvitationTransition(() => {
      apiRequest<{ ok: boolean }>(
        `/events/${selectedEventId}/check-in`,
        {
          method: "POST",
          body: JSON.stringify({
            qrToken: tokenValue,
            method: "QR",
            deviceInfo: "web-dashboard-qr",
            companionPresent,
          }),
        },
        session.accessToken,
      )
        .then(() =>
          apiRequest<EventInvitationRecord[]>(
            `/events/${selectedEventId}/attendees`,
            {},
            session.accessToken,
          ),
        )
        .then((items) => {
          setAttendees(items);
          setQrToken("");
          setCheckInPreview(null);
          setCompanionPresent(false);
          setScannerError(null);
        })
        .catch((error: Error) => {
          setInvitationError(error.message);
        });
    });
  }

  function stopQrScanner() {
    if (qrFrameRef.current) {
      window.cancelAnimationFrame(qrFrameRef.current);
      qrFrameRef.current = null;
    }

    qrStreamRef.current?.getTracks().forEach((track) => track.stop());
    qrStreamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsScannerActive(false);
    qrBusyRef.current = false;
  }

  function queueScanFrame() {
    qrFrameRef.current = window.requestAnimationFrame(async () => {
      const detector = qrDetectorRef.current;
      const video = videoRef.current;

      if (!detector || !video || video.readyState < 2) {
        queueScanFrame();
        return;
      }

      if (qrBusyRef.current) {
        queueScanFrame();
        return;
      }

      qrBusyRef.current = true;

      try {
        const [match] = await detector.detect(video);

        if (match?.rawValue) {
          stopQrScanner();
          setQrToken(match.rawValue);
          previewQrCheckIn(match.rawValue);
          return;
        }
      } catch (error) {
        setScannerError(error instanceof Error ? error.message : "QR-Scan fehlgeschlagen.");
        stopQrScanner();
        return;
      } finally {
        qrBusyRef.current = false;
      }

      queueScanFrame();
    });
  }

  async function startQrScanner() {
    if (!scannerSupported) {
      setScannerError("Dieser Browser unterstuetzt keinen nativen QR-Scan.");
      return;
    }

    try {
      setScannerError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
        },
      });

      qrStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsScannerActive(true);
      queueScanFrame();
    } catch (error) {
      setScannerError(
        error instanceof Error
          ? error.message
          : "Kamera konnte fuer den QR-Scan nicht gestartet werden.",
      );
      stopQrScanner();
    }
  }

  const selectedContactsCount = selectedContactIds.length;
  const overviewCards = [
    {
      title: "Kontakte",
      href: "/backoffice/contacts",
      text: "Kontaktbasis pflegen, durchsuchen und Importe verarbeiten.",
      chips: [`${stats.total} Kontakte`, `${stats.companies} Firmen`],
    },
    {
      title: "Events",
      href: "/backoffice/events",
      text: "Events anlegen, Status steuern und Kapazitaeten pflegen.",
      chips: [`${eventStats.total} Events`, `${eventStats.published} live`],
    },
    {
      title: "Einladungen",
      href: "/backoffice/invitations",
      text: "Gaestelisten zusammenstellen, Versand vorbereiten und Queue anstossen.",
      chips: [`${invitationStats.total} Einladungen`, `${invitationStats.registered} registriert`],
    },
    {
      title: "Live-Dashboard",
      href: "/backoffice/live",
      text: "Veranstaltungsstand live verfolgen: Zusagen, Einlass, No-shows und Kapazitaet.",
      chips: [`${liveStats.checkedInPersons} vor Ort`, `${liveStats.attendanceRate}% Einlass`],
    },
    {
      title: "Check-in",
      href: "/backoffice/checkin",
      text: "Am Eventtag Gaeste manuell oder per QR-Code erfassen.",
      chips: [`${invitationStats.checkedIn} eingecheckt`, activeEvent ? activeEvent.title : "kein Event gewaehlt"],
    },
  ];

  return (
    <main className="workspace-shell">
      <section className="workspace-intro">
        <p className="eyebrow">Backoffice</p>
        <h1>Eventplanung, Einladung und Check-in in einem Arbeitsbereich.</h1>
        <p className="lead">
          Das Backoffice ist jetzt in echte Arbeitsbereiche getrennt. Damit koennen
          wir Kontakte, Events, Einladungen und Check-in sauber weiter ausbauen.
        </p>
      </section>

      <section className="workspace-grid">
        <aside className="panel panel-accent">
          <div className="panel-head">
            <div>
              <p className="section-label">Mitarbeiterzugang</p>
              <h2>Login</h2>
            </div>
            {session ? (
              <button className="ghost-button" onClick={handleLogout} type="button">
                Logout
              </button>
            ) : null}
          </div>

          <form className="stack" onSubmit={handleLogin}>
            <label className="field">
              <span>E-Mail</span>
              <input
                autoComplete="username"
                onChange={(event) => setEmail(event.target.value)}
                value={email}
              />
            </label>

            <label className="field">
              <span>Passwort</span>
              <input
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </label>

            <button className="primary-button" disabled={isPending} type="submit">
              {isPending ? "Anmeldung laeuft..." : "Anmelden"}
            </button>
          </form>

          {authError ? <p className="error-box">{authError}</p> : null}

          <div className="login-hint">
            <p className="section-label">Lokale Seed-Daten</p>
            <p>`admin@example.com` / `ChangeMe123!`</p>
          </div>

          {session ? (
            <div className="identity-card">
              <p className="section-label">Aktive Session</p>
              <strong>
                {session.user.firstName} {session.user.lastName}
              </strong>
              <p>{session.user.email}</p>
              <p>Rolle: {session.user.role}</p>
            </div>
          ) : null}

          {session ? (
            <nav className="backoffice-nav" aria-label="Backoffice Navigation">
              {visibleSections.map((entry) => (
                <Link
                  className={`nav-link ${section === entry.id ? "nav-link-active" : ""}`}
                  href={entry.href}
                  key={entry.id}
                >
                  {entry.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </aside>

        <div className="content-stack">
          {section === "overview" ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="section-label">Arbeitsbereiche</p>
                  <h2>Uebersicht</h2>
                </div>
              </div>

              {!session ? (
                <p className="empty-state">
                  Melde dich zuerst an. Danach kannst du in die einzelnen Bereiche springen.
                </p>
              ) : (
                <div className="overview-grid">
                  {overviewCards
                    .filter((entry) =>
                      entry.href === "/backoffice/checkin"
                        ? canCheckIn(currentRole)
                        : canManagePlanning(currentRole),
                    )
                    .map((entry) => (
                    <article className="overview-card" key={entry.href}>
                      <p className="section-label">{entry.title}</p>
                      <p className="overview-copy">{entry.text}</p>
                      <div className="chip-row">
                        {entry.chips.map((chip) => (
                          <span className="stat-chip" key={chip}>
                            {chip}
                          </span>
                        ))}
                      </div>
                      <Link className="ghost-button nav-button" href={entry.href}>
                        Bereich oeffnen
                      </Link>
                    </article>
                    ))}
                </div>
              )}
            </section>
          ) : null}

          {section !== "overview" && session && !isSectionAllowed ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="section-label">Zugriff</p>
                  <h2>Keine Berechtigung</h2>
                </div>
              </div>
              <p className="empty-state">
                Deine Rolle darf diesen Bereich nicht oeffnen. Nutze die sichtbaren
                Bereiche in der Navigation.
              </p>
            </section>
          ) : null}

          {section === "contacts" && isSectionAllowed ? (
            <section className="panel">
            <div className="panel-head">
              <div>
                <p className="section-label">Kontaktbasis</p>
                <h2>Kontakte</h2>
              </div>
              <div className="chip-row">
                <span className="stat-chip">{stats.total} Kontakte</span>
                <span className="stat-chip">{stats.companies} Firmen</span>
                <span className="stat-chip">{stats.tagged} mit Tags</span>
              </div>
            </div>

            {!session ? (
              <p className="empty-state">
                Melde dich zuerst an. Danach werden Kontakte geladen und du kannst
                neue Datensaetze anlegen.
              </p>
            ) : (
              <>
                <div className="toolbar">
                  <label className="field search-field">
                    <span>Suche</span>
                    <input
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Name, Firma oder E-Mail"
                      value={query}
                    />
                  </label>
                </div>

                <form className="contact-form" onSubmit={handleCreateContact}>
                  <label className="field">
                    <span>Vorname</span>
                    <input
                      onChange={(event) =>
                        setContactForm((current) => ({
                          ...current,
                          firstName: event.target.value,
                        }))
                      }
                      value={contactForm.firstName}
                    />
                  </label>

                  <label className="field">
                    <span>Nachname</span>
                    <input
                      onChange={(event) =>
                        setContactForm((current) => ({
                          ...current,
                          lastName: event.target.value,
                        }))
                      }
                      value={contactForm.lastName}
                    />
                  </label>

                  <label className="field">
                    <span>E-Mail</span>
                    <input
                      onChange={(event) =>
                        setContactForm((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      type="email"
                      value={contactForm.email}
                    />
                  </label>

                  <label className="field">
                    <span>Firma</span>
                    <input
                      onChange={(event) =>
                        setContactForm((current) => ({
                          ...current,
                          company: event.target.value,
                        }))
                      }
                      value={contactForm.company}
                    />
                  </label>

                  <label className="field field-wide">
                    <span>Tags</span>
                    <input
                      onChange={(event) =>
                        setContactForm((current) => ({
                          ...current,
                          tags: event.target.value,
                        }))
                      }
                      placeholder="vip, speaker, presse"
                      value={contactForm.tags}
                    />
                  </label>

                  <button
                    className="primary-button field-wide"
                    disabled={isSubmittingContact}
                    type="submit"
                  >
                    {isSubmittingContact ? "Speichern..." : "Kontakt anlegen"}
                  </button>
                </form>

                <form className="import-form" onSubmit={handleImportContacts}>
                  <label className="field field-wide">
                    <span>Kontakte importieren</span>
                    <input accept=".csv,.xlsx" name="contactFile" type="file" />
                  </label>
                  <button
                    className="ghost-button field-wide"
                    disabled={isImportingContacts}
                    type="submit"
                  >
                    {isImportingContacts ? "Import laeuft..." : "CSV/XLSX importieren"}
                  </button>
                </form>

                {contactError ? <p className="error-box">{contactError}</p> : null}
                {importResult ? (
                  <div className="success-box">
                    <strong>Import abgeschlossen: {importResult.filename}</strong>
                    <p>
                      {importResult.importedRows} von {importResult.totalRows} Zeilen importiert,
                      {` ${importResult.duplicates} Duplikate, ${importResult.errorRows} Fehler`}
                    </p>
                    {importResult.errors.slice(0, 3).map((entry) => (
                      <p key={`${entry.row}-${entry.message}`}>
                        Zeile {entry.row}: {entry.message}
                      </p>
                    ))}
                  </div>
                ) : null}

                <div className="contact-list">
                  {contacts.length === 0 ? (
                    <p className="empty-state">
                      Noch keine Kontakte gefunden. Lege den ersten Datensatz an
                      oder passe die Suche an.
                    </p>
                  ) : (
                    contacts.map((contact) => (
                      <article className="contact-card" key={contact.id}>
                        <div className="contact-card-head">
                          <div>
                            <h3>
                              {contact.firstName} {contact.lastName}
                            </h3>
                            <p>{contact.company ?? "Ohne Firma"}</p>
                          </div>
                          <a href={`mailto:${contact.email}`}>{contact.email}</a>
                        </div>

                        {contact.tags.length > 0 ? (
                          <div className="tag-row">
                            {contact.tags.map((tag) => (
                              <span className="tag" key={tag}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
              </>
            )}
            </section>
          ) : null}

          {section === "events" && isSectionAllowed ? (
            <section className="panel">
            <div className="panel-head">
              <div>
                <p className="section-label">Eventplanung</p>
                <h2>Events</h2>
              </div>
              <div className="chip-row">
                <span className="stat-chip">{eventStats.total} Events</span>
                <span className="stat-chip">{eventStats.published} live</span>
                <span className="stat-chip">{eventStats.draft} Entwuerfe</span>
              </div>
            </div>

            {!session ? (
              <p className="empty-state">
                Nach dem Login kannst du hier Events anlegen und ihren Status
                verfolgen.
              </p>
            ) : (
              <>
                <form className="event-form" onSubmit={handleCreateEvent}>
                  <label className="field field-wide">
                    <span>Titel</span>
                    <input
                      onChange={(event) =>
                        setEventForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      value={eventForm.title}
                    />
                  </label>

                  <label className="field field-wide">
                    <span>Beschreibung</span>
                    <input
                      onChange={(event) =>
                        setEventForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      value={eventForm.description}
                    />
                  </label>

                  <label className="field">
                    <span>Location</span>
                    <input
                      onChange={(event) =>
                        setEventForm((current) => ({
                          ...current,
                          locationName: event.target.value,
                        }))
                      }
                      value={eventForm.locationName}
                    />
                  </label>

                  <label className="field">
                    <span>Adresse</span>
                    <input
                      onChange={(event) =>
                        setEventForm((current) => ({
                          ...current,
                          locationAddress: event.target.value,
                        }))
                      }
                      value={eventForm.locationAddress}
                    />
                  </label>

                  <label className="field">
                    <span>Start</span>
                    <input
                      onChange={(event) =>
                        setEventForm((current) => ({
                          ...current,
                          startsAt: event.target.value,
                        }))
                      }
                      type="datetime-local"
                      value={eventForm.startsAt}
                    />
                  </label>

                  <label className="field">
                    <span>Ende</span>
                    <input
                      onChange={(event) =>
                        setEventForm((current) => ({
                          ...current,
                          endsAt: event.target.value,
                        }))
                      }
                      type="datetime-local"
                      value={eventForm.endsAt}
                    />
                  </label>

                  <label className="field">
                    <span>Zeitzone</span>
                    <input
                      onChange={(event) =>
                        setEventForm((current) => ({
                          ...current,
                          timezone: event.target.value,
                        }))
                      }
                      value={eventForm.timezone}
                    />
                  </label>

                  <label className="field">
                    <span>Kapazitaet</span>
                    <input
                      min="1"
                      onChange={(event) =>
                        setEventForm((current) => ({
                          ...current,
                          capacity: event.target.value,
                        }))
                      }
                      type="number"
                      value={eventForm.capacity}
                    />
                  </label>

                  <label className="field field-wide">
                    <span>Status</span>
                    <select
                      className="select-input"
                      onChange={(event) =>
                        setEventForm((current) => ({
                          ...current,
                          status: event.target.value as EventFormState["status"],
                        }))
                      }
                      value={eventForm.status}
                    >
                      <option value="DRAFT">Entwurf</option>
                      <option value="PUBLISHED">Veroeffentlicht</option>
                    </select>
                  </label>

                  <label className="selector-row field-wide">
                    <input
                      checked={eventForm.allowCompanion}
                      onChange={(event) =>
                        setEventForm((current) => ({
                          ...current,
                          allowCompanion: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>Begleitung erlauben</strong>
                      <small>
                        Gaeste koennen bei der Anmeldung eine Begleitperson mit Vor- und
                        Nachname angeben.
                      </small>
                    </span>
                  </label>

                  <button
                    className="primary-button field-wide"
                    disabled={isSubmittingEvent}
                    type="submit"
                  >
                    {isSubmittingEvent ? "Speichern..." : "Event anlegen"}
                  </button>
                </form>

                {eventError ? <p className="error-box">{eventError}</p> : null}

                <div className="event-list">
                  {events.length === 0 ? (
                    <p className="empty-state">
                      Noch keine Events vorhanden. Lege das erste Event an.
                    </p>
                  ) : (
                    events.map((event) => (
                      <article className="event-card" key={event.id}>
                        <div className="event-card-head">
                          <div>
                            <p className="section-label">{formatStatus(event.status)}</p>
                            <h3>{event.title}</h3>
                          </div>
                          <span className="stat-chip">
                            {event._count.invitations} Einladungen
                          </span>
                        </div>
                        <p className="event-meta">
                          {formatDateTime(event.startsAt)} bis {formatDateTime(event.endsAt)}
                        </p>
                        <p className="event-meta">
                          {event.locationName}
                          {event.locationAddress ? `, ${event.locationAddress}` : ""}
                        </p>
                        <p className="event-meta">
                          {event.capacity
                            ? `Kapazitaet ${event.capacity}`
                            : "Keine Kapazitaet gesetzt"}
                          {` · ${event.timezone}`}
                        </p>
                        <p className="event-meta">
                          {event.allowCompanion
                            ? "Begleitung erlaubt"
                            : "Einladung gilt nur persoenlich"}
                        </p>
                        {event.description ? (
                          <p className="event-description">{event.description}</p>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
              </>
            )}
            </section>
          ) : null}

          {section === "live" && isSectionAllowed ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="section-label">Veranstaltungsdashboard</p>
                  <h2>Live-Status</h2>
                </div>
                <div className="chip-row">
                  <span className="stat-chip">{liveStats.attendanceRate}% Einlassquote</span>
                  <span className="stat-chip">{liveStats.checkedInPersons} Personen vor Ort</span>
                </div>
              </div>

              {!session ? (
                <p className="empty-state">
                  Melde dich zuerst an. Danach kannst du den Live-Status eines Events sehen.
                </p>
              ) : events.length === 0 ? (
                <p className="empty-state">
                  Lege zuerst ein Event an. Danach steht das Live-Dashboard bereit.
                </p>
              ) : (
                <>
                  <label className="field planner-select">
                    <span>Aktives Event</span>
                    <select
                      className="select-input"
                      onChange={(event) => setSelectedEventId(event.target.value)}
                      value={selectedEventId}
                    >
                      <option value="">Event waehlen</option>
                      {events.map((event) => (
                        <option key={event.id} value={event.id}>
                          {event.title}
                        </option>
                      ))}
                    </select>
                  </label>

                  {!selectedEventId || !activeEvent ? (
                    <p className="empty-state">
                      Waehle ein Event, um Einladungen, Zusagen und Einlass live zu verfolgen.
                    </p>
                  ) : (
                    <>
                      {invitationError ? <p className="error-box">{invitationError}</p> : null}

                      <div className="live-hero">
                        <div>
                          <p className="section-label">{formatStatus(activeEvent.status)}</p>
                          <h3>{activeEvent.title}</h3>
                          <p>
                            {formatDateTime(activeEvent.startsAt)} · {activeEvent.locationName}
                          </p>
                        </div>
                        <div className="live-gauge">
                          <strong>{liveStats.checkedInPersons}</strong>
                          <span>von {liveStats.expectedPersons || 0} erwarteten Personen</span>
                        </div>
                      </div>

                      <div className="live-kpi-grid">
                        <article className="live-kpi-card">
                          <span>Eingeladen</span>
                          <strong>{liveStats.invited}</strong>
                        </article>
                        <article className="live-kpi-card">
                          <span>Zugesagt</span>
                          <strong>{liveStats.accepted}</strong>
                        </article>
                        <article className="live-kpi-card">
                          <span>Offen</span>
                          <strong>{liveStats.open}</strong>
                        </article>
                        <article className="live-kpi-card">
                          <span>Abgesagt</span>
                          <strong>{liveStats.declined}</strong>
                        </article>
                        <article className="live-kpi-card">
                          <span>Eingecheckt</span>
                          <strong>{liveStats.checkedIn}</strong>
                        </article>
                        <article className="live-kpi-card">
                          <span>Personen vor Ort</span>
                          <strong>{liveStats.checkedInPersons}</strong>
                        </article>
                        <article className="live-kpi-card">
                          <span>Begleitungen</span>
                          <strong>
                            {liveStats.companionCheckedIn}/{liveStats.companionExpected}
                          </strong>
                        </article>
                        <article className="live-kpi-card">
                          <span>Kapazitaet</span>
                          <strong>
                            {activeEvent.capacity
                              ? `${liveStats.capacityRate}%`
                              : "offen"}
                          </strong>
                        </article>
                      </div>

                      <div className="live-progress">
                        <div>
                          <span>Einlassfortschritt</span>
                          <strong>{liveStats.attendanceRate}%</strong>
                        </div>
                        <meter
                          max={100}
                          min={0}
                          value={Math.min(liveStats.attendanceRate, 100)}
                        />
                      </div>

                      <div className="planner-grid">
                        <div className="selection-panel">
                          <p className="section-label">Zugesagt, noch nicht da</p>
                          <div className="selection-list">
                            {liveStats.noShows.length === 0 ? (
                              <p className="empty-state">
                                Alle zugesagten Gaeste sind eingecheckt oder es gibt noch keine
                                Zusagen.
                              </p>
                            ) : (
                              liveStats.noShows.slice(0, 8).map((invitation) => (
                                <article className="attendee-card" key={`${invitation.id}-live-open`}>
                                  <div className="attendee-head">
                                    <div>
                                      <strong>
                                        {invitation.contact.firstName}{" "}
                                        {invitation.contact.lastName}
                                      </strong>
                                      <small>
                                        {invitation.contact.company ?? "Ohne Firma"} ·{" "}
                                        {invitation.contact.email}
                                      </small>
                                    </div>
                                    <span className="tag">
                                      {invitation.registration?.guestCount ?? 1} Pers.
                                    </span>
                                  </div>
                                </article>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="selection-panel">
                          <p className="section-label">Zuletzt eingecheckt</p>
                          <div className="selection-list">
                            {liveStats.recentCheckIns.length === 0 ? (
                              <p className="empty-state">Noch keine Check-ins fuer dieses Event.</p>
                            ) : (
                              liveStats.recentCheckIns.map((invitation) => (
                                <article className="attendee-card" key={`${invitation.id}-recent`}>
                                  <div className="attendee-head">
                                    <div>
                                      <strong>
                                        {invitation.contact.firstName}{" "}
                                        {invitation.contact.lastName}
                                      </strong>
                                      <small>
                                        {invitation.checkIns?.[0]?.checkedInAt
                                          ? formatDateTime(invitation.checkIns[0].checkedInAt)
                                          : "Zeitpunkt unbekannt"}
                                      </small>
                                    </div>
                                    <span className="tag">
                                      {invitation.checkIns?.[0]?.companionPresent
                                        ? "+ Begleitung"
                                        : "Solo"}
                                    </span>
                                  </div>
                                </article>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </section>
          ) : null}

          {section === "invitations" && isSectionAllowed ? (
            <section className="panel">
            <div className="panel-head">
              <div>
                <p className="section-label">Einladungsplanung</p>
                <h2>Gaesteliste</h2>
              </div>
              <div className="chip-row">
                <span className="stat-chip">{invitationStats.total} eingeladen</span>
                <span className="stat-chip">{invitationStats.queued} queued</span>
                <span className="stat-chip">{invitationStats.registered} registriert</span>
                <span className="stat-chip">
                  {invitationStats.checkedInPersons} Personen eingecheckt
                </span>
              </div>
            </div>

            {!session ? (
              <p className="empty-state">
                Nach dem Login kannst du hier Kontakte einem Event zuordnen und
                den Versand vorbereiten.
              </p>
            ) : events.length === 0 ? (
              <p className="empty-state">
                Lege zuerst ein Event an. Danach kannst du Kontakte auf die
                Einladungsliste setzen.
              </p>
            ) : (
              <>
                <label className="field planner-select">
                  <span>Aktives Event</span>
                  <select
                    className="select-input"
                    onChange={(event) => setSelectedEventId(event.target.value)}
                    value={selectedEventId}
                  >
                    <option value="">Event waehlen</option>
                    {events.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.title}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedEventId ? (
                  <>
                    <div className="planner-actions">
                      <button
                        className="primary-button"
                        disabled={isSubmittingInvitations || selectedContactIds.length === 0}
                        onClick={handleCreateInvitations}
                        type="button"
                      >
                        {isSubmittingInvitations
                          ? "Erzeuge..."
                          : `Einladungen erzeugen (${selectedContactIds.length})`}
                      </button>
                      <button
                        className="ghost-button"
                        disabled={isSubmittingInvitations || attendees.length === 0}
                        onClick={handleQueueInvitations}
                        type="button"
                      >
                        Versand vorbereiten
                      </button>
                      <button
                        className="ghost-button"
                        disabled={isSubmittingInvitations}
                        onClick={handleProcessEmailQueue}
                        type="button"
                      >
                        Queue verarbeiten
                      </button>
                    </div>

                    {invitationError ? (
                      <p className="error-box">{invitationError}</p>
                    ) : null}

                    <form className="import-form guest-import-form" onSubmit={handleImportGuests}>
                      <label className="field field-wide">
                        <span>Gaesteliste fuer dieses Event importieren</span>
                        <input accept=".csv,.xlsx" name="guestFile" type="file" />
                      </label>
                      <button
                        className="ghost-button field-wide"
                        disabled={isImportingGuests}
                        type="submit"
                      >
                        {isImportingGuests
                          ? "Gaesteliste wird importiert..."
                          : "Excel/CSV als Gaesteliste importieren"}
                      </button>
                    </form>

                    {importResult ? (
                      <div className="success-box">
                        <strong>Import abgeschlossen: {importResult.filename}</strong>
                        <p>
                          {importResult.importedRows} von {importResult.totalRows} Zeilen verarbeitet,
                          {` ${importResult.createdInvitations ?? 0} neue Einladungen, ${importResult.skippedInvitations ?? importResult.duplicates} bereits vorhanden, ${importResult.errorRows} Fehler`}
                        </p>
                        {importResult.errors.slice(0, 3).map((entry) => (
                          <p key={`${entry.row}-${entry.message}`}>
                            Zeile {entry.row}: {entry.message}
                          </p>
                        ))}
                      </div>
                    ) : null}

                    <div className="template-panel">
                      <div className="panel-head compact-head">
                        <div>
                          <p className="section-label">Serienbrief</p>
                          <h3>Einladungstext</h3>
                        </div>
                      </div>

                      <label className="field field-wide">
                        <span>Betreff</span>
                        <input
                          onChange={(event) =>
                            setInvitationTemplate((current) => ({
                              ...current,
                              subject: event.target.value,
                            }))
                          }
                          value={invitationTemplate.subject}
                        />
                      </label>

                      <label className="field field-wide">
                        <span>Mail-Text</span>
                        <textarea
                          className="textarea-input"
                          onChange={(event) =>
                            setInvitationTemplate((current) => ({
                              ...current,
                              body: event.target.value,
                            }))
                          }
                          rows={10}
                          value={invitationTemplate.body}
                        />
                      </label>

                      <p className="template-help">
                        Platzhalter werden beim Versand je Gast ersetzt. Der Antwortlink und
                        QR-Code werden weiterhin automatisch erzeugt.
                      </p>

                      <div className="template-field-grid">
                        {TEMPLATE_FIELDS.map((field) => (
                          <button
                            className="field-chip"
                            key={field.token}
                            onClick={() => insertTemplateField("body", field.token)}
                            type="button"
                          >
                            {field.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <details className="manual-selection-panel" open={attendees.length === 0}>
                      <summary>
                        Kontakte manuell hinzufuegen
                        {selectedContactIds.length > 0 ? ` (${selectedContactIds.length})` : ""}
                      </summary>
                      <p className="template-help">
                        Nur erforderlich, wenn du einzelne Kontakte ohne Gaestelistenimport
                        ergaenzen willst.
                      </p>
                      <div className="selection-list compact-selection-list">
                        {contacts.map((contact) => (
                          <label className="selector-row compact-selector-row" key={contact.id}>
                            <input
                              checked={selectedContactIds.includes(contact.id)}
                              onChange={() => toggleSelectedContact(contact.id)}
                              type="checkbox"
                            />
                            <span>
                              <strong>
                                {contact.firstName} {contact.lastName}
                              </strong>
                              <small>{contact.email}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </details>

                    <div className="selection-panel invitation-list-panel">
                      <div className="panel-head compact-head">
                        <div>
                          <p className="section-label">Aktuelle Einladungsliste</p>
                          <h3>{attendees.length} Gaeste</h3>
                        </div>
                      </div>
                      <div className="invitation-table">
                        {attendees.length === 0 ? (
                          <p className="empty-state">
                            Fuer dieses Event gibt es noch keine Einladungen.
                          </p>
                        ) : (
                          attendees.map((invitation) => (
                            <article className="invitation-row" key={invitation.id}>
                              <strong>
                                {invitation.contact.firstName} {invitation.contact.lastName}
                              </strong>
                              <span>{formatInvitationStatus(invitation.status)}</span>
                              <span>{invitation.registration?.guestCount ?? 1} Pers.</span>
                              <span>
                                {invitation.registration?.companionRequested
                                  ? `${invitation.registration.companionFirstName ?? ""} ${
                                      invitation.registration.companionLastName ?? ""
                                    }`
                                  : ""}
                              </span>
                            </article>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="checkin-panel">
                      <p className="empty-state">
                        Der operative Check-in ist jetzt in einen eigenen Bereich verschoben.
                        Nutze dafuer den Bereich "Check-in".
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="empty-state">
                    Waehle ein Event, um Kontakte zuzuordnen und den Versand
                    einzuplanen.
                  </p>
                )}
              </>
            )}
            </section>
          ) : null}

          {section === "checkin" && isSectionAllowed ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <p className="section-label">Eventtag</p>
                  <h2>Mobiler Check-in</h2>
                </div>
                <div className="chip-row">
                  <span className="stat-chip">{invitationStats.checkedIn} eingecheckt</span>
                  <span className="stat-chip">
                    {invitationStats.checkedInPersons} Personen durch Einlass
                  </span>
                  <span className="stat-chip">{filteredAttendees.length} Treffer</span>
                </div>
              </div>

              {!session ? (
                <p className="empty-state">
                  Melde dich zuerst an. Danach kannst du Gaeste manuell oder per QR einchecken.
                </p>
              ) : events.length === 0 ? (
                <p className="empty-state">
                  Lege zuerst ein Event an. Danach steht die Check-in-Liste bereit.
                </p>
              ) : (
                <>
                  <label className="field planner-select">
                    <span>Aktives Event</span>
                    <select
                      className="select-input"
                      onChange={(event) => setSelectedEventId(event.target.value)}
                      value={selectedEventId}
                    >
                      <option value="">Event waehlen</option>
                      {events.map((event) => (
                        <option key={event.id} value={event.id}>
                          {event.title}
                        </option>
                      ))}
                    </select>
                  </label>

                  {!selectedEventId ? (
                    <p className="empty-state">
                      Waehle ein Event, um die Einlassliste zu laden.
                    </p>
                  ) : (
                    <>
                      {invitationError ? <p className="error-box">{invitationError}</p> : null}

                      <div className="qr-checkin-box">
                        <div className="scanner-toolbar">
                          <button
                            className="ghost-button"
                            disabled={isSubmittingInvitations || !scannerSupported || isScannerActive}
                            onClick={startQrScanner}
                            type="button"
                          >
                            Kamera-Scan starten
                          </button>
                          {isScannerActive ? (
                            <button
                              className="ghost-button"
                              onClick={stopQrScanner}
                              type="button"
                            >
                              Scan stoppen
                            </button>
                          ) : null}
                        </div>

                        {scannerSupported ? (
                          <div className="scanner-frame">
                            <video
                              autoPlay
                              className="scanner-video"
                              muted
                              playsInline
                              ref={videoRef}
                            />
                            {!isScannerActive ? (
                              <p className="scanner-placeholder">
                                Kamera aus. Du kannst den Scan starten oder den Token manuell
                                einfuegen.
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="empty-state">
                            Dieser Browser bietet keinen nativen QR-Scan. Nutze in diesem Fall
                            die manuelle Eingabe.
                          </p>
                        )}

                        {scannerError ? <p className="error-box">{scannerError}</p> : null}

                        <label className="field field-wide">
                          <span>QR-Token scannen oder einfuegen</span>
                          <input
                            onChange={(event) => setQrToken(event.target.value)}
                            placeholder="Signierter QR-Token"
                            value={qrToken}
                          />
                        </label>
                        <button
                          className="ghost-button"
                          disabled={isSubmittingInvitations || !qrToken.trim()}
                          onClick={handleQrCheckIn}
                          type="button"
                        >
                          QR pruefen
                        </button>
                      </div>

                      {checkInPreview ? (
                        <div className="checkin-preview">
                          <p className="section-label">Scan erkannt</p>
                          <h3>
                            {checkInPreview.contact.firstName}{" "}
                            {checkInPreview.contact.lastName}
                          </h3>
                          <p className="attendee-meta">
                            Status: {formatInvitationStatus(checkInPreview.status)}
                          </p>
                          {checkInPreview.registration?.companionRequested ? (
                            <label className="selector-row">
                              <input
                                checked={companionPresent}
                                onChange={(event) => setCompanionPresent(event.target.checked)}
                                type="checkbox"
                              />
                              <span>
                                <strong>Begleitung ist dabei</strong>
                                <small>
                                  {checkInPreview.registration.companionFirstName}{" "}
                                  {checkInPreview.registration.companionLastName}
                                </small>
                              </span>
                            </label>
                          ) : (
                            <p className="empty-state">
                              Fuer diese Anmeldung ist keine Begleitung hinterlegt.
                            </p>
                          )}
                          <button
                            className="primary-button"
                            disabled={
                              isSubmittingInvitations ||
                              !["SENT", "REGISTERED"].includes(checkInPreview.status)
                            }
                            onClick={() => submitQrCheckIn(qrToken.trim())}
                            type="button"
                          >
                            Check-in bestaetigen
                          </button>
                        </div>
                      ) : null}

                      <label className="field search-field">
                        <span>Suche in der Gaesteliste</span>
                        <input
                          onChange={(event) => setCheckInQuery(event.target.value)}
                          placeholder="Name, Firma oder E-Mail"
                          value={checkInQuery}
                        />
                      </label>

                      <div className="selection-list">
                        {filteredAttendees.length === 0 ? (
                          <p className="empty-state">Keine passenden Teilnehmer gefunden.</p>
                        ) : (
                          filteredAttendees.map((invitation) => (
                            <article className="attendee-card" key={`${invitation.id}-checkin`}>
                              <div className="attendee-head">
                                <div>
                                  <strong>
                                    {invitation.contact.firstName} {invitation.contact.lastName}
                                  </strong>
                                  <small>
                                    {invitation.contact.company ?? "Ohne Firma"} ·{" "}
                                    {invitation.contact.email}
                                  </small>
                                </div>
                                <span className="tag">
                                  {formatInvitationStatus(invitation.status)}
                                </span>
                              </div>
                              <p className="attendee-meta">
                                Letzter Check-in:{" "}
                                {invitation.checkIns?.[0]?.checkedInAt
                                  ? formatDateTime(invitation.checkIns[0].checkedInAt)
                                  : "noch keiner"}
                                {invitation.checkIns?.[0]?.companionPresent
                                  ? " · Begleitung dabei"
                                  : ""}
                              </p>
                              {invitation.registration?.companionRequested ? (
                                <p className="attendee-meta">
                                  Begleitung angemeldet:{" "}
                                  {invitation.registration.companionFirstName}{" "}
                                  {invitation.registration.companionLastName}
                                </p>
                              ) : null}
                              <div className="planner-actions compact-actions">
                                <button
                                  className="primary-button"
                                  disabled={
                                    isSubmittingInvitations ||
                                    !["SENT", "REGISTERED"].includes(invitation.status)
                                  }
                                  onClick={() => handleCheckIn(invitation.id)}
                                  type="button"
                                >
                                  {invitation.status === "CHECKED_IN"
                                    ? "Schon eingecheckt"
                                    : "Manuell einchecken"}
                                </button>
                              </div>
                            </article>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
