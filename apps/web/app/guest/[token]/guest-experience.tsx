"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type InvitationPayload = {
  id: string;
  status: string;
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
  };
  registration: {
    response: "ACCEPTED" | "DECLINED";
    guestCount: number;
    comment: string | null;
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
  const [comment, setComment] = useState("");
  const [dietaryRequirements, setDietaryRequirements] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;

    startTransition(() => {
      fetch(`${API_URL}/api/guest/invitation/${token}`)
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
              setComment(payload.registration.comment ?? "");
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

    startTransition(() => {
      fetch(`${API_URL}/api/guest/invitation/${token}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          response,
          guestCount: response === "ACCEPTED" ? Number(guestCount) : 1,
          comment: comment || undefined,
          dietaryRequirements: dietaryRequirements || undefined,
        }),
      })
        .then(async (result) => {
          if (!result.ok) {
            const payload = await result.json().catch(() => null);
            throw new Error(payload?.message ?? "Antwort konnte nicht gespeichert werden");
          }

          return result.json();
        })
        .then(() => {
          setSuccess(
            response === "ACCEPTED"
              ? "Deine Teilnahme ist registriert. Die Bestaetigungsmail wird vorbereitet."
              : "Deine Absage wurde gespeichert.",
          );
        })
        .catch((submitError: Error) => {
          setError(submitError.message);
        });
    });
  }

  return (
    <main className="guest-shell">
      <section className="guest-panel">
        <p className="eyebrow">Einladung</p>
        <h1>{invitation?.event.title ?? "Event wird geladen"}</h1>
        {error ? <p className="error-box">{error}</p> : null}

        {invitation ? (
          <>
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
            </div>

            {invitation.event.description ? (
              <p className="guest-description">{invitation.event.description}</p>
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
                  <option value="ACCEPTED">Ich nehme teil</option>
                  <option value="DECLINED">Ich sage ab</option>
                </select>
              </label>

              <label className="field">
                <span>Anzahl Personen</span>
                <input
                  disabled={response !== "ACCEPTED"}
                  min="1"
                  onChange={(event) => setGuestCount(event.target.value)}
                  type="number"
                  value={guestCount}
                />
              </label>

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

            <a className="guest-link" href={`${API_URL}/api/guest/invitation/${token}/ics`}>
              ICS-Datei herunterladen
            </a>
          </>
        ) : (
          <p className="empty-state">Einladung wird geladen...</p>
        )}
      </section>
    </main>
  );
}
