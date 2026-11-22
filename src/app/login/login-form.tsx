"use client";

import { apiFetch } from "@/lib/api-fetch";
import { safeNextPath } from "@/lib/base-path";
import { useState } from "react";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error || "Could not sign in.");
        return;
      }
      window.location.assign(safeNextPath(nextPath));
    } catch {
      setError("Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-16">
      <p className="font-[family-name:var(--font-sans)] text-[11px] uppercase tracking-[0.22em] text-ink-soft">
        Pronunciation reader
      </p>
      <h1 className="hanzi mt-2 text-3xl">课文</h1>
      <p className="mt-3 font-[family-name:var(--font-sans)] text-sm leading-relaxed text-ink-soft">
        Enter the shared passcode to open the library.
      </p>
      <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
        <label className="block">
          <span className="font-[family-name:var(--font-sans)] text-xs uppercase tracking-[0.16em] text-ink-soft">
            Passcode
          </span>
          <input
            type="password"
            name="passcode"
            autoComplete="current-password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[color-mix(in_oklab,var(--color-ink)_14%,transparent)] bg-white/50 px-3 py-2"
            required
          />
        </label>
        {error ? (
          <p className="font-[family-name:var(--font-sans)] text-sm text-cinnabar">{error}</p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-cinnabar px-5 py-2 font-[family-name:var(--font-sans)] text-sm font-medium text-paper disabled:opacity-60"
        >
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
