"use client";

// "Link Google account" for the existing password account. Only runs when the
// coach presses the button (never on page load). Reports the account id
// continuity explicitly; the password sign-in is never removed here.

import * as React from "react";
import { onAuthStateChanged, type Auth, type User } from "firebase/auth";

import { Button } from "@/components/ui/Button";
import { hasGoogle, linkGoogle } from "@/lib/coachAccess";

export function LinkGoogleCard(props: { auth: Auth }) {
  const { auth } = props;
  const [user, setUser] = React.useState<User | null>(auth.currentUser);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  React.useEffect(() => onAuthStateChanged(auth, setUser), [auth]);

  if (!user) return null;
  const linked = hasGoogle(user);

  async function run() {
    if (busy || !user) return;
    setBusy(true);
    setMsg(null);
    const before = user.uid;
    try {
      const res = await linkGoogle(auth);
      setMsg({
        kind: "ok",
        text: res.uid === before ? "Google is linked. Your account is unchanged, and your password still works." : "Linked.",
      });
      setUser(auth.currentUser);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Google could not be linked." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Google sign-in" data-link-google={linked ? "linked" : "available"} className="flex flex-wrap items-center gap-2 text-xs">
      {linked ? (
        <span style={{ color: "var(--muted)" }}>Google sign-in is linked to this account.</span>
      ) : (
        <>
          <span style={{ color: "var(--muted)" }}>Use Google to sign in next time:</span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run()}>
            {busy ? "Linking…" : "Link Google account"}
          </Button>
        </>
      )}
      {msg ? (
        <span role={msg.kind === "err" ? "alert" : "status"} className="font-semibold">
          {msg.text}
        </span>
      ) : null}
    </section>
  );
}
