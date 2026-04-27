"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";

const API_PROXY_BASE = "/backend-api";

type InvitationPayload = {
  id: string;
  status: string;
  accessCode: string;
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    company: string | null;
  };
  event: {
    title: string;
    description: string | null;
    locationName: string;
    locationAddress: string | null;
    startsAt: string;
    endsAt: string;
    timezone: string;
    allowCompanion: boolean;
  };
  invitation: {
    subject: string;
    salutation: string;
    title: string;
    body: string;
    info: string | null;
    acceptLabel: string;
    declineLabel: string;
  };
  registration: {
    response: "ACCEPTED" | "DECLINED";
    guestCount: number;
    comment: string | null;
    dietaryRequirements: string | null;
    companionRequested?: boolean;
    companionFirstName?: string | null;
    companionLastName?: string | null;
  } | null;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(value));
}

export function GuestExperience({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<InvitationPayload | null>(null);
  const [response, setResponse] = useState<"ACCEPTED" | "DECLINED">("ACCEPTED");
  const [guestCount, setGuestCount] = useState("1");
  const [companionRequested, setCompanionRequested] = useState(false);
  const [companionFirstName, setCompanionFirstName] = useState("");
  const [companionLastName, setCompanionLastName] = useState("");
  const [comment, setComment] = useState("");
  const [dietaryRequirements, setDietaryRequirements] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [isResending, startResendTransition] = useTransition();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;

    startTransition(() => {
      fetch(`${API_PROXY_BASE}/guest/invitation/${token}`)
        .then(async (result) => {
          if (!result.ok) {
            const payload = await result.json().catch(() => null);
            throw new Error(payload?.message ?? "Einladung konnte nicht geladen werden");
          }

          return result.json() as Promise<InvitationPayload>;
        })
        .then((payload) => {
          if (active) {
            setInvitation(payload);
            if (payload.registration) {
              setResponse(payload.registration.response);
              setGuestCount(String(payload.registration.guestCount));
              setCompanionRequested(payload.registration.companionRequested === true);
              setCompanionFirstName(payload.registration.companionFirstName ?? "");
              setCompanionLastName(payload.registration.companionLastName ?? "");
              setComment(payload.registration.comment ?? "");
              setDietaryRequirements(payload.registration.dietaryRequirements ?? "");
            }
          }
        })
        .catch((loadError: Error) => {
          if (active) {
            setError(loadError.message);
          }
        });
    });

    return () => {
      active = false;
    };
  }, [token]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setResendSuccess(null);

    startTransition(() => {
      fetch(`${API_PROXY_BASE}/guest/invitation/${token}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          response,
          guestCount: response === "ACCEPTED" ? Number(guestCount) : 1,
          comment: comment || undefined,
          dietaryRequirements: dietaryRequirements || undefined,
          companionRequested:
            response === "ACCEPTED" && invitation?.event.allowCompanion
              ? companionRequested
              : false,
          companionFirstName:
            companionRequested && response === "ACCEPTED" ? companionFirstName : undefined,
          companionLastName:
            companionRequested && response === "ACCEPTED" ? companionLastName : undefined,
        }),
      })
        .then(async (result) => {
          if (!result.ok) {
            const payload = await result.json().catch(() => null);
            throw new Error(payload?.message ?? "Antwort konnte nicht gespeichert werden");
          }

          return result.json();
        })
        .then((payload: { registration: InvitationPayload["registration"] }) => {
          if (payload.registration) {
            setInvitation((current) =>
              current
                ? {
                    ...current,
                    status: response === "ACCEPTED" ? "REGISTERED" : "DECLINED",
                    registration: payload.registration,
                  }
                : current,
            );
          }
          setSuccess(
            response === "ACCEPTED"
              ? "Deine Teilnahme ist registriert. Die Bestaetigungsmail mit QR-Code wird versendet."
              : "Deine Absage wurde gespeichert.",
          );
        })
        .catch((submitError: Error) => {
          setError(submitError.message);
        });
    });
  }

  function handleResendQrCode() {
    setError(null);
    setResendSuccess(null);

    startResendTransition(() => {
      fetch(`${API_PROXY_BASE}/guest/invitation/${token}/resend-qr`, {
        method: "POST",
      })
        .then(async (result) => {
          if (!result.ok) {
            const payload = await result.json().catch(() => null);
            throw new Error(payload?.message ?? "QR-Code konnte nicht erneut versendet werden");
          }

          return result.json();
        })
        .then(() => {
          setResendSuccess("Die E-Mail mit QR-Code wurde erneut versendet.");
        })
        .catch((resendError: Error) => {
          setError(resendError.message);
        });
    });
  }

  return (
    <main className="guest-shell">
      <section className="guest-panel">
        <p className="eyebrow">Einladung</p>
        <h1>{invitation?.invitation.title ?? invitation?.event.title ?? "Event wird geladen"}</h1>
        {error ? <p className="error-box">{error}</p> : null}

        {invitation ? (
          <>
            <div className="guest-greeting">
              <p>{invitation.invitation.salutation}</p>
              <div className="guest-invitation-text">{invitation.invitation.body}</div>
            </div>

            <div className="guest-summary">
              <p>
                {invitation.contact.firstName} {invitation.contact.lastName}
              </p>
              <p>{invitation.contact.email}</p>
              <p>
                {formatDateTime(invitation.event.startsAt)} bis{" "}
                {formatDateTime(invitation.event.endsAt)}
              </p>
              <p>
                {invitation.event.locationName}
                {invitation.event.locationAddress
                  ? `, ${invitation.event.locationAddress}`
                  : ""}
              </p>
              <p>Einladungscode: {invitation.accessCode}</p>
            </div>

            {invitation.event.description ? (
              <p className="guest-description">{invitation.event.description}</p>
            ) : null}

            {invitation.invitation.info ? (
              <div className="guest-info-box">{invitation.invitation.info}</div>
            ) : null}

            <form className="guest-form" onSubmit={handleSubmit}>
              <label className="field field-wide">
                <span>Antwort</span>
                <select
                  className="select-input"
                  onChange={(event) =>
                    setResponse(event.target.value as "ACCEPTED" | "DECLINED")
                  }
                  value={response}
                >
                  <option value="ACCEPTED">{invitation.invitation.acceptLabel}</option>
                  <option value="DECLINED">{invitation.invitation.declineLabel}</option>
                </select>
              </label>

              {invitation.event.allowCompanion && response === "ACCEPTED" ? (
                <label className="selector-row field-wide">
                  <input
                    checked={companionRequested}
                    onChange={(event) => {
                      setCompanionRequested(event.target.checked);
                      setGuestCount(event.target.checked ? "2" : "1");
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>Ich bringe eine Begleitung mit</strong>
                    <small>Bitte Vor- und Nachname der Begleitperson angeben.</small>
                  </span>
                </label>
              ) : null}

              {invitation.event.allowCompanion && companionRequested && response === "ACCEPTED" ? (
                <>
                  <label className="field">
                    <span>Vorname Begleitung</span>
                    <input
                      onChange={(event) => setCompanionFirstName(event.target.value)}
                      required
                      value={companionFirstName}
                    />
                  </label>

                  <label className="field">
                    <span>Nachname Begleitung</span>
                    <input
                      onChange={(event) => setCompanionLastName(event.target.value)}
                      required
                      value={companionLastName}
                    />
                  </label>
                </>
              ) : null}

              <label className="field">
                <span>Besondere Wuensche</span>
                <input
                  disabled={response !== "ACCEPTED"}
                  onChange={(event) => setDietaryRequirements(event.target.value)}
                  value={dietaryRequirements}
                />
              </label>

              <label className="field field-wide">
                <span>Kommentar</span>
                <input onChange={(event) => setComment(event.target.value)} value={comment} />
              </label>

              <button className="primary-button field-wide" disabled={isPending} type="submit">
                {isPending ? "Speichern..." : "Antwort senden"}
              </button>
            </form>

            {success ? <p className="success-box">{success}</p> : null}

            {invitation.registration?.response === "ACCEPTED" ? (
              <div className="guest-ticket-box">
                <p className="section-label">Dein Ticket</p>
                <p>
                  Nach Ihrer Zusage bekommen Sie eine E-Mail mit QR-Code fuer den
                  Einlass und dem Kalendereintrag.
                </p>
                <div className="guest-ticket-actions">
                  <button
                    className="ghost-button"
                    disabled={isResending}
                    onClick={handleResendQrCode}
                    type="button"
                  >
                    {isResending ? "Wird versendet..." : "QR-Code erneut per E-Mail senden"}
                  </button>
                  <a className="guest-link" href={`${API_PROXY_BASE}/guest/invitation/${token}/ics`}>
                    ICS-Datei herunterladen
                  </a>
                </div>
                {resendSuccess ? <p className="success-box">{resendSuccess}</p> : null}
              </div>
            ) : null}
          </>
        ) : (
          <p className="empty-state">Einladung wird geladen...</p>
        )}
      </section>
    </main>
  );
}
