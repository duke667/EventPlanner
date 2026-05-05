"use client";

import Link from "next/link";
import {
  ChangeEvent,
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
import type QrScanner from "qr-scanner";

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
type QrScannerModule = typeof import("qr-scanner");
type QrScannerInstance = InstanceType<typeof QrScanner>;
type QrScannerResult = {
  data: string;
  cornerPoints: Array<{ x: number; y: number }>;
};

type SessionState = LoginResponse | null;

type ContactFormState = {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  tags: string;
};

type RegisterFormState = {
  email: string;
  password: string;
  role: UserRole;
};

type EventFormState = {
  title: string;
  description: string;
  guestPageTitle: string;
  guestPageIntro: string;
  guestPageInfo: string;
  guestAcceptLabel: string;
  guestDeclineLabel: string;
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

type CheckInNotice = {
  tone: "success" | "warning";
  title: string;
  detail: string;
};

const initialContactForm: ContactFormState = {
  firstName: "",
  lastName: "",
  email: "",
  company: "",
  tags: "",
};

const initialRegisterForm: RegisterFormState = {
  email: "",
  password: "",
  role: "EVENT_PLANNER",
};

const initialEventForm: EventFormState = {
  title: "",
  description: "",
  guestPageTitle: "",
  guestPageIntro: "",
  guestPageInfo: "",
  guestAcceptLabel: "Ich nehme teil",
  guestDeclineLabel: "Ich sage ab",
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
    "",
    "Alternativ koennen Sie auf der Gastseite diesen Einladungscode eingeben:",
    "{{invitationCodeUrl}}",
    "{{invitationCode}}",
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
  { token: "invitationCodeUrl", label: "Code-Seite" },
  { token: "invitationCode", label: "Einladungscode" },
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

function formatCheckInTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function buildCheckInNotice(invitation: EventInvitationRecord): CheckInNotice {
  const lastCheckInAt = formatCheckInTimestamp(invitation.checkIns?.[0]?.checkedInAt);

  if (invitation.status === "CHECKED_IN") {
    return {
      tone: "warning",
      title: "Gast ist bereits eingecheckt",
      detail: lastCheckInAt
        ? `Letzter Check-in: ${lastCheckInAt}. Bitte nur erneut bestaetigen, wenn der Einlass wirklich korrigiert werden muss.`
        : "Fuer diesen Gast existiert bereits ein Check-in. Bitte Mehrfacherfassungen vermeiden.",
    };
  }

  return {
    tone: "success",
    title: "Scan bereit zur Bestaetigung",
    detail: "Daten kurz pruefen und den Check-in danach final bestaetigen.",
  };
}

function canManagePlanning(role?: UserRole) {
  return role === "ADMIN" || role === "EVENT_PLANNER" || role === "STAFF";
}

function canCheckIn(role?: UserRole) {
  return role === "ADMIN" || role === "EVENT_PLANNER" || role === "STAFF" || role === "CHECK_IN";
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
  const [registerForm, setRegisterForm] = useState<RegisterFormState>(initialRegisterForm);
  const [query, setQuery] = useState("");
  const [checkInQuery, setCheckInQuery] = useState("");
  const [qrToken, setQrToken] = useState("");
  const [checkInPreview, setCheckInPreview] = useState<EventInvitationRecord | null>(null);
  const [companionPresent, setCompanionPresent] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactForm, setContactForm] =
    useState<ContactFormState>(initialContactForm);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editContactForm, setEditContactForm] =
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
  const [invitationSuccess, setInvitationSuccess] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerHint, setScannerHint] = useState<string | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [checkInNotice, setCheckInNotice] = useState<CheckInNotice | null>(null);
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [scannerSupported, setScannerSupported] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isSubmittingContact, startContactTransition] = useTransition();
  const [isRegistering, startRegisterTransition] = useTransition();
  const [isImportingContacts, startImportTransition] = useTransition();
  const [isImportingGuests, startGuestImportTransition] = useTransition();
  const [isSubmittingEvent, startEventTransition] = useTransition();
  const [isSubmittingInvitations, startInvitationTransition] = useTransition();
  const deferredQuery = useDeferredValue(query);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const qrFileInputRef = useRef<HTMLInputElement | null>(null);
  const qrScannerModuleRef = useRef<QrScannerModule | null>(null);
  const qrScannerRef = useRef<QrScannerInstance | null>(null);
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

    if (!window.isSecureContext) {
      setScannerHint(
        "Kamera- und QR-Scan funktionieren nur ueber HTTPS oder auf localhost. Bitte die Backoffice-URL entsprechend aufrufen.",
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerHint(
        "Dieser Browser blockiert den Kamera-Zugriff. Bitte auf Safari/Chrome in aktueller Version wechseln.",
      );
      return;
    }

    let active = true;

    import("qr-scanner")
      .then(async (module) => {
        if (!active) {
          return;
        }

        qrScannerModuleRef.current = module;
        const hasCamera = await module.default.hasCamera().catch(() => false);

        if (!active) {
          return;
        }

        setScannerSupported(hasCamera);
        setScannerHint(
          hasCamera
            ? "Auf iPhone und iPad kann der Scan je nach WebKit-Version stabiler ueber die Kamera oder alternativ ueber ein direkt aufgenommenes Foto laufen."
            : "Auf diesem Geraet wurde keine nutzbare Kamera erkannt. Bitte QR-Token manuell eingeben oder ein Foto des QR-Codes aufnehmen.",
        );
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setScannerSupported(false);
        setScannerHint(
          "Der QR-Scanner konnte nicht geladen werden. Bitte QR-Token manuell eingeben oder ein Foto des QR-Codes aufnehmen.",
        );
      });

    return () => {
      active = false;
    };
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
      setCheckInPreview(null);
      setCheckInError(null);
      setCheckInNotice(null);
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
            setCheckInError(null);
          }
        })
        .catch((error: Error) => {
          if (active) {
            setCheckInError(error.message);
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
      qrScannerRef.current?.destroy();
      qrScannerRef.current = null;
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

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);

    startRegisterTransition(() => {
      apiRequest<LoginResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify(registerForm),
      })
        .then((result) => {
          setSession(result);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
          setEmail(registerForm.email);
          setPassword("");
          setRegisterForm(initialRegisterForm);
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

  function beginEditContact(contact: Contact) {
    setEditingContactId(contact.id);
    setEditContactForm({
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      company: contact.company ?? "",
      tags: contact.tags.join(", "),
    });
  }

  function handleUpdateContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.accessToken || !editingContactId) {
      return;
    }

    setContactError(null);

    startContactTransition(() => {
      apiRequest<Contact>(
        `/contacts/${editingContactId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            firstName: editContactForm.firstName,
            lastName: editContactForm.lastName,
            email: editContactForm.email,
            company: editContactForm.company || undefined,
            tags: parseTags(editContactForm.tags),
          }),
        },
        session.accessToken,
      )
        .then((updated) => {
          setContacts((current) =>
            current.map((contact) => (contact.id === updated.id ? updated : contact)),
          );
          setEditingContactId(null);
          setEditContactForm(initialContactForm);
        })
        .catch((error: Error) => {
          setContactError(error.message);
        });
    });
  }

  function handleDeleteContact(contact: Contact) {
    if (!session?.accessToken) {
      return;
    }

    const confirmed = window.confirm(
      `${contact.firstName} ${contact.lastName} wirklich loeschen? Zugehoerige Einladungen, Antworten und Check-ins werden ebenfalls entfernt.`,
    );

    if (!confirmed) {
      return;
    }

    setContactError(null);

    startContactTransition(() => {
      apiRequest<{ ok: boolean }>(
        `/contacts/${contact.id}`,
        {
          method: "DELETE",
        },
        session.accessToken,
      )
        .then(() => {
          const removedFromSelectedEvent = attendees.some(
            (invitation) => invitation.contactId === contact.id,
          );
          setContacts((current) => current.filter((item) => item.id !== contact.id));
          setAttendees((current) =>
            current.filter((invitation) => invitation.contactId !== contact.id),
          );
          setEvents((current) =>
            current.map((event) =>
              event.id === selectedEventId
                ? {
                    ...event,
                    _count: {
                      invitations: removedFromSelectedEvent
                        ? Math.max(0, event._count.invitations - 1)
                        : event._count.invitations,
                    },
                  }
                : event,
            ),
          );
          setSelectedContactIds((current) => current.filter((id) => id !== contact.id));
          if (editingContactId === contact.id) {
            setEditingContactId(null);
            setEditContactForm(initialContactForm);
          }
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
            guestPageTitle: eventForm.guestPageTitle || undefined,
            guestPageIntro: eventForm.guestPageIntro || undefined,
            guestPageInfo: eventForm.guestPageInfo || undefined,
            guestAcceptLabel: eventForm.guestAcceptLabel || undefined,
            guestDeclineLabel: eventForm.guestDeclineLabel || undefined,
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
    setInvitationSuccess(null);

    startInvitationTransition(() => {
      apiRequest<{ queued: number; updated: number }>(
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
        .then((result) =>
          apiRequest<EventInvitationRecord[]>(
            `/events/${selectedEventId}/attendees`,
            {},
            session.accessToken,
          ).then((items) => ({ items, result })),
        )
        .then(({ items, result }) => {
          setInvitationSuccess(
            result.queued + result.updated > 0
              ? `${result.queued} Mailjobs eingeplant, ${result.updated} bestehende aktualisiert. Klicke danach auf "Mails versenden".`
              : "Keine neuen Mailjobs eingeplant. Entweder wurden die Einladungen bereits versendet oder es gibt keine offenen Einladungen.",
          );
          setAttendees(items);
        })
        .catch((error: Error) => {
          setInvitationError(error.message);
        });
    });
  }

  function formatMailErrors(
    errors: Array<{ recipient?: string; message: string }>,
  ) {
    return errors
      .slice(0, 3)
      .map((entry) => `${entry.recipient ?? "unbekannter Empfaenger"}: ${entry.message}`)
      .join(" | ");
  }

  function handleProcessEmailQueue() {
    if (!session?.accessToken) {
      return;
    }

    setInvitationError(null);
    setInvitationSuccess("Mailversand wird gestartet...");

    startInvitationTransition(() => {
      apiRequest<{
        processed: number;
        failed: number;
        errors: Array<{ jobId: string; recipient?: string; message: string }>;
      }>(
        "/jobs/process-email-queue",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
        session.accessToken,
      )
        .then((items) => {
          if (items.failed > 0) {
            setInvitationError(
              `${items.failed} Mail(s) konnten nicht versendet werden. ${formatMailErrors(items.errors)}`,
            );
          } else {
            setInvitationSuccess(
              items.processed > 0
                ? `${items.processed} Mail(s) erfolgreich versendet.`
                : "Keine offenen Mailjobs gefunden. Wurde vorher 'Versand vorbereiten' geklickt?",
            );
          }

          return items;
        })
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

  function insertTemplateField(target: keyof InvitationTemplateState, token: string) {
    setInvitationTemplate((current) => ({
      ...current,
      [target]: `${current[target]}{{${token}}}`,
    }));
  }

  function handleCheckIn(invitationId: string) {
    if (!session?.accessToken || !selectedEventId) {
      return;
    }

    const invitation = attendees.find((entry) => entry.id === invitationId);

    if (invitation?.status === "CHECKED_IN") {
      setCheckInError(null);
      setCheckInNotice(buildCheckInNotice(invitation));
      return;
    }

    setCheckInError(null);
    setCheckInNotice(null);

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
          const checkedInInvitation = items.find((entry) => entry.id === invitationId);
          const checkedInAt = formatCheckInTimestamp(
            checkedInInvitation?.checkIns?.[0]?.checkedInAt,
          );
          setCheckInNotice({
            tone: "success",
            title: "Check-in erfolgreich",
            detail: checkedInAt
              ? `${checkedInInvitation?.contact.firstName ?? "Gast"} ${checkedInInvitation?.contact.lastName ?? ""} wurde um ${checkedInAt} eingecheckt.`
              : "Der Gast wurde erfolgreich eingecheckt.",
          });
        })
        .catch((error: Error) => {
          setCheckInError(error.message);
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

    setCheckInError(null);
    setCheckInNotice(null);

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
          setCheckInNotice(buildCheckInNotice(preview));
        })
        .catch((error: Error) => {
          setCheckInError(error.message);
        });
    });
  }

  function submitQrCheckIn(tokenValue: string) {
    if (!session?.accessToken || !selectedEventId || !tokenValue) {
      return;
    }

    if (checkInPreview?.status === "CHECKED_IN") {
      setCheckInError(null);
      setCheckInNotice(buildCheckInNotice(checkInPreview));
      return;
    }

    setCheckInError(null);
    setCheckInNotice(null);

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
          const checkedInInvitation = items.find((entry) => entry.id === checkInPreview?.id);
          const checkedInAt = formatCheckInTimestamp(
            checkedInInvitation?.checkIns?.[0]?.checkedInAt,
          );
          setQrToken("");
          stopQrScanner();
          setCheckInPreview(null);
          setCompanionPresent(false);
          setScannerError(null);
          setCheckInNotice({
            tone: "success",
            title: "QR-Check-in erfolgreich",
            detail: checkedInAt
              ? `${checkedInInvitation?.contact.firstName ?? "Gast"} ${checkedInInvitation?.contact.lastName ?? ""} wurde um ${checkedInAt} eingecheckt.`
              : "Der QR-Check-in wurde erfolgreich gespeichert.",
          });
        })
        .catch((error: Error) => {
          setCheckInError(error.message);
        });
    });
  }

  function stopQrScanner() {
    qrScannerRef.current?.stop();

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsScannerActive(false);
  }

  async function startQrScanner() {
    if (!videoRef.current || !scannerSupported) {
      setScannerError(
        scannerHint ?? "Dieser Browser unterstuetzt keinen Kamera-QR-Scan.",
      );
      return;
    }

    try {
      const module = qrScannerModuleRef.current ?? (await import("qr-scanner"));
      qrScannerModuleRef.current = module;
      setScannerError(null);
      setCheckInError(null);
      setCheckInNotice(null);

      if (!qrScannerRef.current) {
        qrScannerRef.current = new module.default(
          videoRef.current,
          (result: QrScannerResult) => {
            stopQrScanner();
            setQrToken(result.data);
            previewQrCheckIn(result.data);
          },
          {
            preferredCamera: "environment",
            maxScansPerSecond: 8,
            returnDetailedScanResult: true,
            onDecodeError: () => {
              // Continuous scanning should stay quiet while no code is visible.
            },
          },
        );
      }

      await qrScannerRef.current.start();
      setIsScannerActive(true);
    } catch (error) {
      setScannerError(
        error instanceof Error
          ? error.message
          : "Kamera konnte fuer den QR-Scan nicht gestartet werden.",
      );
      stopQrScanner();
    }
  }

  function handleOpenQrCapture() {
    qrFileInputRef.current?.click();
  }

  function handleQrImageCapture(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!file) {
      return;
    }

    const module = qrScannerModuleRef.current;

    if (!module) {
      setScannerError("QR-Fotoauswertung ist noch nicht bereit. Bitte erneut versuchen.");
      return;
    }

    setScannerError(null);
    setCheckInError(null);
    setCheckInNotice(null);

    startInvitationTransition(() => {
      module.default
        .scanImage(file, { returnDetailedScanResult: true })
        .then((result: QrScannerResult) => {
          setQrToken(result.data);
          previewQrCheckIn(result.data);
        })
        .catch((error: Error | string) => {
          const message =
            typeof error === "string"
              ? error
              : error instanceof Error
                ? error.message
                : "QR-Code konnte im Foto nicht erkannt werden.";
          setScannerError(message);
        });
    });
  }

  const selectedContactsCount = selectedContactIds.length;
  const overviewCards = [
    {
      title: "Kontakte",
      href: "/backoffice/contacts",
      text: "Adressen pflegen, suchen und fuer Einladungen vorbereiten.",
      chips: [`${stats.total} Kontakte`, `${stats.companies} Firmen`],
    },
    {
      title: "Events",
      href: "/backoffice/events",
      text: "Veranstaltungen anlegen, Kapazitaeten planen und Status steuern.",
      chips: [`${eventStats.total} Events`, `${eventStats.published} live`],
    },
    {
      title: "Einladungen",
      href: "/backoffice/invitations",
      text: "Gaestelisten importieren, Einladungstexte erstellen und Versand starten.",
      chips: [`${invitationStats.total} Einladungen`, `${invitationStats.registered} registriert`],
    },
    {
      title: "Live-Dashboard",
      href: "/backoffice/live",
      text: "Zusagen, Einlass und Personen vor Ort waehrend der Veranstaltung verfolgen.",
      chips: [`${liveStats.checkedInPersons} vor Ort`, `${liveStats.attendanceRate}% Einlass`],
    },
    {
      title: "Check-in",
      href: "/backoffice/checkin",
      text: "Gaeste am Eingang suchen, QR-Codes pruefen und Einlass bestaetigen.",
      chips: [`${invitationStats.checkedIn} eingecheckt`, activeEvent ? activeEvent.title : "kein Event gewaehlt"],
    },
  ];

  return (
    <main className="workspace-shell">
      <section className="workspace-intro">
        <p className="eyebrow">Backoffice</p>
        <h1>Veranstaltungen sicher organisieren.</h1>
        <p className="lead">
          Kontakte verwalten, Gaeste einladen, Rueckmeldungen verfolgen und den
          Einlass am Veranstaltungstag im Blick behalten.
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

          {!session ? (
            <form className="stack register-box" onSubmit={handleRegister}>
              <div>
                <p className="section-label">Neu anmelden</p>
                <h3>Konto erstellen</h3>
              </div>

              <label className="field">
                <span>E-Mail</span>
                <input
                  autoComplete="email"
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  type="email"
                  value={registerForm.email}
                />
              </label>

              <label className="field">
                <span>Passwort</span>
                <input
                  autoComplete="new-password"
                  minLength={8}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  type="password"
                  value={registerForm.password}
                />
              </label>

              <label className="field">
                <span>Rolle</span>
                <select
                  className="select-input"
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      role: event.target.value as UserRole,
                    }))
                  }
                  value={registerForm.role}
                >
                  <option value="EVENT_PLANNER">Event Planer</option>
                  <option value="CHECK_IN">Check-in</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>

              <button className="ghost-button" disabled={isRegistering} type="submit">
                {isRegistering ? "Konto wird erstellt..." : "Registrieren"}
              </button>
            </form>
          ) : null}

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
                  <h2>Was steht an?</h2>
                </div>
              </div>

              {!session ? (
                <p className="empty-state">
                  Melde dich an, um Veranstaltungen, Gaestelisten und Check-in zu verwalten.
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
                        Oeffnen
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
                Menuepunkte in der Navigation.
              </p>
            </section>
          ) : null}

          {section === "contacts" && isSectionAllowed ? (
            <section className="panel">
            <div className="panel-head">
              <div>
                <p className="section-label">Kontaktbasis</p>
                <h2>Adressen</h2>
              </div>
              <div className="chip-row">
                <span className="stat-chip">{stats.total} Kontakte</span>
                <span className="stat-chip">{stats.companies} Firmen</span>
                <span className="stat-chip">{stats.tagged} mit Tags</span>
              </div>
            </div>

            {!session ? (
              <p className="empty-state">
                Melde dich an, um Kontakte zu suchen, anzulegen oder zu importieren.
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
                        {editingContactId === contact.id ? (
                          <form className="contact-edit-form" onSubmit={handleUpdateContact}>
                            <label className="field">
                              <span>Vorname</span>
                              <input
                                onChange={(event) =>
                                  setEditContactForm((current) => ({
                                    ...current,
                                    firstName: event.target.value,
                                  }))
                                }
                                value={editContactForm.firstName}
                              />
                            </label>
                            <label className="field">
                              <span>Nachname</span>
                              <input
                                onChange={(event) =>
                                  setEditContactForm((current) => ({
                                    ...current,
                                    lastName: event.target.value,
                                  }))
                                }
                                value={editContactForm.lastName}
                              />
                            </label>
                            <label className="field">
                              <span>E-Mail</span>
                              <input
                                onChange={(event) =>
                                  setEditContactForm((current) => ({
                                    ...current,
                                    email: event.target.value,
                                  }))
                                }
                                type="email"
                                value={editContactForm.email}
                              />
                            </label>
                            <label className="field">
                              <span>Firma</span>
                              <input
                                onChange={(event) =>
                                  setEditContactForm((current) => ({
                                    ...current,
                                    company: event.target.value,
                                  }))
                                }
                                value={editContactForm.company}
                              />
                            </label>
                            <label className="field field-wide">
                              <span>Tags</span>
                              <input
                                onChange={(event) =>
                                  setEditContactForm((current) => ({
                                    ...current,
                                    tags: event.target.value,
                                  }))
                                }
                                value={editContactForm.tags}
                              />
                            </label>
                            <div className="button-row field-wide">
                              <button
                                className="primary-button"
                                disabled={isSubmittingContact}
                                type="submit"
                              >
                                Speichern
                              </button>
                              <button
                                className="ghost-button"
                                onClick={() => {
                                  setEditingContactId(null);
                                  setEditContactForm(initialContactForm);
                                }}
                                type="button"
                              >
                                Abbrechen
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
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

                            <div className="button-row">
                              <button
                                className="ghost-button"
                                onClick={() => beginEditContact(contact)}
                                type="button"
                              >
                                Bearbeiten
                              </button>
                              <button
                                className="danger-button"
                                onClick={() => handleDeleteContact(contact)}
                                type="button"
                              >
                                Loeschen
                              </button>
                            </div>
                          </>
                        )}
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
                <h2>Veranstaltungen</h2>
              </div>
              <div className="chip-row">
                <span className="stat-chip">{eventStats.total} Events</span>
                <span className="stat-chip">{eventStats.published} live</span>
                <span className="stat-chip">{eventStats.draft} Entwuerfe</span>
              </div>
            </div>

            {!session ? (
              <p className="empty-state">
                Melde dich an, um Veranstaltungen anzulegen und zu planen.
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

                  <div className="template-panel field-wide">
                    <div className="panel-head compact-head">
                      <div>
                        <p className="section-label">Gastseite</p>
                        <h3>Vorlage fuer eingeladene Gaeste</h3>
                      </div>
                    </div>
                    <p className="template-help">
                      Diese Texte erscheinen auf der persoenlichen Anmeldeseite. Wenn
                      die Einleitung leer bleibt, wird der Einladungstext aus dem
                      Mailversand verwendet.
                    </p>

                    <label className="field field-wide">
                      <span>Seitentitel</span>
                      <input
                        onChange={(event) =>
                          setEventForm((current) => ({
                            ...current,
                            guestPageTitle: event.target.value,
                          }))
                        }
                        placeholder="z. B. Ihre Einladung zum Stadtgeburtstag"
                        value={eventForm.guestPageTitle}
                      />
                    </label>

                    <label className="field field-wide">
                      <span>Einleitung auf der Gastseite</span>
                      <textarea
                        className="textarea-input"
                        onChange={(event) =>
                          setEventForm((current) => ({
                            ...current,
                            guestPageIntro: event.target.value,
                          }))
                        }
                        placeholder="Text, der nach der persoenlichen Anrede angezeigt wird."
                        rows={5}
                        value={eventForm.guestPageIntro}
                      />
                    </label>

                    <label className="field field-wide">
                      <span>Zusatzinformation</span>
                      <textarea
                        className="textarea-input"
                        onChange={(event) =>
                          setEventForm((current) => ({
                            ...current,
                            guestPageInfo: event.target.value,
                          }))
                        }
                        placeholder="z. B. Hinweise zu Einlass, Parken oder Garderobe."
                        rows={3}
                        value={eventForm.guestPageInfo}
                      />
                    </label>

                    <label className="field">
                      <span>Text fuer Zusage</span>
                      <input
                        onChange={(event) =>
                          setEventForm((current) => ({
                            ...current,
                            guestAcceptLabel: event.target.value,
                          }))
                        }
                        value={eventForm.guestAcceptLabel}
                      />
                    </label>

                    <label className="field">
                      <span>Text fuer Absage</span>
                      <input
                        onChange={(event) =>
                          setEventForm((current) => ({
                            ...current,
                            guestDeclineLabel: event.target.value,
                          }))
                        }
                        value={eventForm.guestDeclineLabel}
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span>Ort der Veranstaltung</span>
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
                    {isSubmittingEvent ? "Speichern..." : "Veranstaltung anlegen"}
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
                  <h2>Live-Stand</h2>
                </div>
                <div className="chip-row">
                  <span className="stat-chip">{liveStats.attendanceRate}% Einlassquote</span>
                  <span className="stat-chip">{liveStats.checkedInPersons} Personen vor Ort</span>
                </div>
              </div>

              {!session ? (
                <p className="empty-state">
                  Melde dich an, um Zusagen, Einlass und Personen vor Ort live zu verfolgen.
                </p>
              ) : events.length === 0 ? (
                <p className="empty-state">
                  Lege zuerst eine Veranstaltung an. Danach steht der Live-Stand bereit.
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
                      <option value="">Veranstaltung waehlen</option>
                      {events.map((event) => (
                        <option key={event.id} value={event.id}>
                          {event.title}
                        </option>
                      ))}
                    </select>
                  </label>

                  {!selectedEventId || !activeEvent ? (
                     <p className="empty-state">
                      Waehle eine Veranstaltung, um Zusagen und Einlass live zu verfolgen.
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
                <h2>Einladen</h2>
              </div>
              <div className="chip-row">
                <span className="stat-chip">{invitationStats.total} eingeladen</span>
                <span className="stat-chip">{invitationStats.queued} vorbereitet</span>
                <span className="stat-chip">{invitationStats.registered} registriert</span>
                <span className="stat-chip">
                  {invitationStats.checkedInPersons} Personen eingecheckt
                </span>
              </div>
            </div>

            {!session ? (
              <p className="empty-state">
                Melde dich an, um Gaestelisten zu importieren und Einladungen zu versenden.
              </p>
            ) : events.length === 0 ? (
              <p className="empty-state">
                Lege zuerst eine Veranstaltung an. Danach kannst du die Gaesteliste vorbereiten.
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
                    <option value="">Veranstaltung waehlen</option>
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
                        Mails versenden
                      </button>
                    </div>

                    {invitationError ? (
                      <p className="error-box">{invitationError}</p>
                    ) : null}
                    {invitationSuccess ? (
                      <p className="success-box">{invitationSuccess}</p>
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
                        Den Einlass bearbeitest du im Menuepunkt "Check-in".
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
                  <h2>Check-in</h2>
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
                  Melde dich an, um Gaeste am Eingang einzuchecken.
                </p>
              ) : events.length === 0 ? (
                <p className="empty-state">
                  Lege zuerst eine Veranstaltung an. Danach steht die Check-in-Liste bereit.
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
                      <option value="">Veranstaltung waehlen</option>
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
                      {checkInError ? <p className="error-box">{checkInError}</p> : null}
                      {checkInNotice ? (
                        <div
                          className={`checkin-notice checkin-notice-${checkInNotice.tone}`}
                        >
                          <p className="section-label">{checkInNotice.title}</p>
                          <p>{checkInNotice.detail}</p>
                        </div>
                      ) : null}

                      <div className="checkin-layout">
                        <div className="qr-checkin-box">
                          <div className="scanner-toolbar">
                            <button
                              className="ghost-button"
                              disabled={
                                isSubmittingInvitations || !scannerSupported || isScannerActive
                              }
                              onClick={startQrScanner}
                              type="button"
                            >
                              Kamera-Scan starten
                            </button>
                            <button
                              className="ghost-button"
                              disabled={isSubmittingInvitations}
                              onClick={handleOpenQrCapture}
                              type="button"
                            >
                              Kamera-Foto pruefen
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
                              {scannerHint ??
                                "Dieser Browser bietet keinen Kamera-QR-Scan. Nutze in diesem Fall die manuelle Eingabe oder ein Kamera-Foto."}
                            </p>
                          )}

                          {scannerError ? <p className="error-box">{scannerError}</p> : null}
                          <input
                            accept="image/*"
                            capture="environment"
                            className="visually-hidden"
                            onChange={handleQrImageCapture}
                            ref={qrFileInputRef}
                            type="file"
                          />

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

                        <aside className="checkin-help-card">
                          <p className="section-label">Ablauf am Einlass</p>
                          <h3>Schneller Ablauf</h3>
                          <ol className="checkin-steps">
                            <li>Aktives Event waehlen.</li>
                            <li>QR-Code scannen oder Token einfuegen.</li>
                            <li>Namen und Begleitung kurz pruefen.</li>
                            <li>Check-in final bestaetigen.</li>
                          </ol>
                          <p className="checkin-help-note">
                            Falls ein Gast bereits eingecheckt ist, zeigt die Vorschau einen
                            Warnhinweis statt einer erneuten Freigabe.
                          </p>
                          <p className="checkin-help-note">
                            Auf iPhone und iPad kann statt Live-Scan auch direkt ein Kamera-Foto
                            des QR-Codes aufgenommen und geprueft werden.
                          </p>
                        </aside>
                      </div>

                      {checkInPreview ? (
                        <div
                          className={`checkin-preview ${
                            checkInPreview.status === "CHECKED_IN"
                              ? "checkin-preview-warning"
                              : ""
                          }`}
                        >
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
                            {checkInPreview.status === "CHECKED_IN"
                              ? "Bereits eingecheckt"
                              : "Check-in bestaetigen"}
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
