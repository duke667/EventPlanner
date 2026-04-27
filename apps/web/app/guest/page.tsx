"use client";

import { FormEvent, Suspense, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API_PROXY_BASE = "/backend-api";

function GuestCodeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState(searchParams.get("code") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const initialCode = searchParams.get("code");

    if (initialCode) {
      resolveCode(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function resolveCode(value: string) {
    const normalizedCode = value.replace(/[^a-z0-9]/gi, "").toUpperCase();

    if (!normalizedCode) {
      setError("Bitte geben Sie Ihren Einladungscode ein.");
      return;
    }

    setError(null);

    startTransition(() => {
      fetch(`${API_PROXY_BASE}/guest/code/${normalizedCode}`)
        .then(async (result) => {
          if (!result.ok) {
            const payload = await result.json().catch(() => null);
            throw new Error(payload?.message ?? "Einladungscode wurde nicht gefunden");
          }

          return result.json() as Promise<{ token: string }>;
        })
        .then((payload) => {
          router.push(`/guest/${payload.token}`);
        })
        .catch((resolveError: Error) => {
          setError(resolveError.message);
        });
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resolveCode(code);
  }

  return (
    <main className="guest-shell">
      <section className="guest-panel guest-code-panel">
        <p className="eyebrow">Einladung</p>
        <h1>Persoenlichen Einladungsbereich oeffnen</h1>
        <p className="guest-description">
          Geben Sie den Einladungscode aus Ihrer E-Mail ein. Bindestriche koennen
          Sie weglassen.
        </p>

        {error ? <p className="error-box">{error}</p> : null}

        <form className="guest-form" onSubmit={handleSubmit}>
          <label className="field field-wide">
            <span>Einladungscode</span>
            <input
              autoComplete="one-time-code"
              autoFocus
              onChange={(event) => setCode(event.target.value)}
              placeholder="ABCD-2345"
              value={code}
            />
          </label>

          <button className="primary-button field-wide" disabled={isPending} type="submit">
            {isPending ? "Wird geprueft..." : "Einladung oeffnen"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function GuestCodePage() {
  return (
    <Suspense fallback={<p className="empty-state">Einladung wird geladen...</p>}>
      <GuestCodeForm />
    </Suspense>
  );
}
