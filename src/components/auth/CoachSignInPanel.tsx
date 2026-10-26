"use client";

// Multi-coach mode Coach Login: "Continue with Google", with the existing
// email/password form as a fallback for the original coach until password
// sign-in is retired. Signing in grants nothing by itself — Admin checks the
// invitation/coach record before showing any team data.

import * as React from "react";
import type { Auth } from "firebase/auth";

import { signInWithGoogle } from "@/lib/coachAccess";

export function CoachSignInPanel(props: {
  auth: Auth | null;
  disabled: boolean;
  onSignedInAction: (user: { uid: string; email: string | null; displayName: string | null }) => void;
  onUsePasswordAction: () => void;
  onCancelAction: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => buttonRef.current?.focus(), []);

  async function onGoogle() {
    if (!props.auth || busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = await signInWithGoogle(props.auth);
      if (user) props.onSignedInAction({ uid: user.uid, email: user.email, displayName: user.displayName });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google sign-in did not complete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-4 rounded-xl border p-3"
      data-coach-signin
      style={{
        borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background: "color-mix(in oklab, var(--bg-base) 80%, transparent)",
      }}
    >
      <div className="text-sm font-semibold">Coach Login</div>
      <div className="mt-3 flex flex-col gap-2">
        <button
          ref={buttonRef}
          type="button"
          disabled={busy || props.disabled || !props.auth}
          onClick={() => void onGoogle()}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: "linear-gradient(90deg, var(--primary), var(--secondary))", color: "black" }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
            <path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3zM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22zM6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9zM12 6c1.5 0 2.8.5 3.9 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.8 9.4 6 12 6z" />
          </svg>
          {busy ? "Waiting for Google…" : "Continue with Google"}
        </button>
        {error ? (
          <div role="alert" className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "color-mix(in oklab, var(--accent-2) 45%, transparent)", background: "color-mix(in oklab, var(--accent-2) 18%, transparent)" }}>
            {error}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 text-xs">
          <button type="button" className="underline" style={{ color: "var(--muted)" }} disabled={busy} onClick={props.onUsePasswordAction}>
            Use email and password instead
          </button>
          <button type="button" className="font-semibold" disabled={busy} onClick={props.onCancelAction}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
