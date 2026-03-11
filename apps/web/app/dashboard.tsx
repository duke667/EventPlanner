"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import type {
  Contact,
  ContactImportResult,
  EventInvitationRecord,
  EventRecord,
  LoginResponse,
} from "@event-manager/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const STORAGE_KEY = "event-manager-session";

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
};

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

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, {
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

export function Dashboard() {
  const [session, setSession] = useState<SessionState>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [attendees, setAttendees] = useState<EventInvitationRecord[]>([]);
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("ChangeMe123!");
  const [query, setQuery] = useState("");
  const [checkInQuery, setCheckInQuery] = useState("");
  const [qrToken, setQrToken] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactForm, setContactForm] =
    useState<ContactFormState>(initialContactForm);
  const [importResult, setImportResult] = useState<ContactImportResult | null>(null);
  const [eventForm, setEventForm] = useState<EventFormState>(initialEventForm);
  const [authError, setAuthError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSubmittingContact, startContactTransition] = useTransition();
  const [isImportingContacts, startImportTransition] = useTransition();
  const [isSubmittingEvent, startEventTransition] = useTransition();
  const [isSubmittingInvitations, startInvitationTransition] = useTransition();
  const deferredQuery = useDeferredValue(query);

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

    startTransition(() => {
      Promise.all([
        apiRequest<Contact[]>(
          `/contacts${deferredQuery ? `?query=${encodeURIComponent(deferredQuery)}` : ""}`,
          {},
          session.accessToken,
        ),
        apiRequest<EventRecord[]>("/events", {}, session.accessToken),
      ])
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
    }),
    [attendees],
  );

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

      fetch(`${API_URL}/api/contacts/import`, {
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
          body: JSON.stringify({ templateType: "INVITATION" }),
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

    setInvitationError(null);

    startInvitationTransition(() => {
      apiRequest<{ ok: boolean }>(
        `/events/${selectedEventId}/check-in`,
        {
          method: "POST",
          body: JSON.stringify({
            qrToken: qrToken.trim(),
            method: "QR",
            deviceInfo: "web-dashboard-qr",
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
        })
        .catch((error: Error) => {
          setInvitationError(error.message);
        });
    });
  }

  return (
    <main className="workspace-shell">
      <section className="workspace-intro">
        <p className="eyebrow">Backoffice Start</p>
        <h1>Ein Mitarbeiter-Login und das erste Kontaktmodul sind live.</h1>
        <p className="lead">
          Dieses Frontend spricht direkt mit der neuen API. Damit koennen wir
          ab jetzt UI und Fachlogik parallel weiterentwickeln.
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
        </aside>

        <div className="content-stack">
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
                <span className="stat-chip">{invitationStats.checkedIn} eingecheckt</span>
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

                    <div className="planner-grid">
                      <div className="selection-panel">
                        <p className="section-label">Kontakte auswaehlen</p>
                        <div className="selection-list">
                          {contacts.map((contact) => (
                            <label className="selector-row" key={contact.id}>
                              <input
                                checked={selectedContactIds.includes(contact.id)}
                                onChange={() => toggleSelectedContact(contact.id)}
                                type="checkbox"
                              />
                              <span>
                                <strong>
                                  {contact.firstName} {contact.lastName}
                                </strong>
                                <small>
                                  {contact.company ?? "Ohne Firma"} · {contact.email}
                                </small>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="selection-panel">
                        <p className="section-label">Aktuelle Einladungsliste</p>
                        <div className="selection-list">
                          {attendees.length === 0 ? (
                            <p className="empty-state">
                              Fuer dieses Event gibt es noch keine Einladungen.
                            </p>
                          ) : (
                            attendees.map((invitation) => (
                              <article className="attendee-card" key={invitation.id}>
                                <div className="attendee-head">
                                  <div>
                                    <strong>
                                      {invitation.contact.firstName} {invitation.contact.lastName}
                                    </strong>
                                    <small>{invitation.contact.email}</small>
                                  </div>
                                  <span className="tag">
                                    {formatInvitationStatus(invitation.status)}
                                  </span>
                                </div>
                                <p className="attendee-meta">
                                  {invitation.contact.company ?? "Ohne Firma"}
                                </p>
                                <p className="attendee-meta">
                                  Jobs: {invitation.emailJobs.length}
                                  {invitation.registration
                                    ? ` · Antwort ${invitation.registration.response}`
                                    : ""}
                                </p>
                              </article>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="checkin-panel">
                      <div className="panel-head">
                        <div>
                          <p className="section-label">Eventtag</p>
                          <h3>Mobiler Check-in</h3>
                        </div>
                      </div>

                      <div className="qr-checkin-box">
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
                          QR Check-in ausfuehren
                        </button>
                      </div>

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
                          <p className="empty-state">
                            Keine passenden Teilnehmer gefunden.
                          </p>
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
                              </p>
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
        </div>
      </section>
    </main>
  );
}
