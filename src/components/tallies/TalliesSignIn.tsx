"use client";

// Tallies coach sign-in (multi-coach builds). Reuses the Checkpoint B
// sign-in: "Continue with Google" (invitation-only), plus the existing
// email/password fallback for the original coach until Google is linked.
// Signing in grants nothing by itself: the workspace gate on /admin checks
// the invitation/coach record (Firestore rules decide), and shows
// "Access not enabled" otherwise. Nothing here reveals who is invited.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";

import { TalliesLockup } from "@/components/brand/TalliesBrand";
import { getFirebaseAuth, signInWithEmailAndPassword } from "@/lib/firebase.client";
import { signInWithGoogle } from "@/lib/coachAccess";
import { clearSession, writeSession } from "@/lib/session";

function passwordError(err: unknown): string {
  const code = typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "";
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look valid.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again in a bit.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return "Sign-in didn't complete. Please try again.";
  }
}

type Busy = null | "google" | "password";

export function TalliesSignIn() {
  const router = useRouter();
  const auth = React.useMemo(() => getFirebaseAuth(), []);
  const [user, setUser] = React.useState<User | null | undefined>(undefined);
  const [busy, setBusy] = React.useState<Busy>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [usePassword, setUsePassword] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    document.title = "Coach sign in · Tallies";
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, [auth]);

  React.useEffect(() => {
    if (user !== undefined) headingRef.current?.focus({ preventScroll: true });
  }, [user]);

  React.useEffect(() => {
    if (usePassword) emailRef.current?.focus();
  }, [usePassword]);

  const enter = React.useCallback(
    (u: { uid: string; email: string | null; displayName: string | null }) => {
      writeSession({ role: "coach", name: u.displayName ?? "Coach", email: u.email ?? "", uid: u.uid });
      router.replace("/admin/");
    },
    [router],
  );

  async function onGoogle() {
    if (busy) return;
    setBusy("google");
    setError(null);
    try {
      const u = await signInWithGoogle(auth);
      if (u) enter(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google sign-in didn't complete.");
    } finally {
      setBusy(null);
    }
  }

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy("password");
    setError(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword("");
      enter(cred.user);
    } catch (err) {
      setError(passwordError(err));
    } finally {
      setBusy(null);
    }
  }

  async function onSignOut() {
    await signOut(auth).catch(() => {});
    clearSession();
  }

  return (
    <div className="tallies flex flex-col" data-tallies-signin>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8">
        <Link href="/" aria-label="Tallies home" className="mx-auto rounded-lg">
          <TalliesLockup size={34} />
        </Link>

        <div className="tallies-card mt-6 p-6 sm:p-7">
          {user === undefined ? (
            <p role="status" className="text-sm" style={{ color: "var(--t-muted)" }}>
              Checking sign-in…
            </p>
          ) : user ? (
            <>
              <h1 ref={headingRef} tabIndex={-1} className="text-xl font-extrabold outline-none">
                You&rsquo;re signed in
              </h1>
              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                Signed in as {user.email ?? "your coach account"}.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" className="tallies-btn" onClick={() => enter(user)}>
                  Go to your workspace
                </button>
                <button type="button" className="tallies-btn tallies-btn--quiet" onClick={() => void onSignOut()}>
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 ref={headingRef} tabIndex={-1} className="text-xl font-extrabold outline-none">
                Coach sign in
              </h1>
              <p className="mt-1 text-sm" style={{ color: "var(--t-muted)" }}>
                Tallies is invitation only. Use the Google account your invitation was sent to.
              </p>

              <button
                type="button"
                className="tallies-btn mt-5 w-full"
                disabled={busy !== null}
                onClick={() => void onGoogle()}
                data-google-signin
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
                  <path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3zM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22zM6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9zM12 6c1.5 0 2.8.5 3.9 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.8 9.4 6 12 6z" />
                </svg>
                {busy === "google" ? "Waiting for Google…" : "Continue with Google"}
              </button>

              {error ? (
                <p
                  role="alert"
                  className="mt-3 rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--t-coral)", background: "color-mix(in oklab, var(--t-coral) 10%, transparent)" }}
                >
                  {error}
                </p>
              ) : null}

              {usePassword ? (
                <form className="mt-5 grid gap-2 border-t pt-5" style={{ borderColor: "var(--t-line)" }} onSubmit={(e) => void onPassword(e)}>
                  <label className="text-sm font-semibold" htmlFor="tallies-email">
                    Email
                  </label>
                  <input
                    ref={emailRef}
                    id="tallies-email"
                    className="tallies-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    inputMode="email"
                    autoComplete="email"
                  />
                  <label className="mt-1 text-sm font-semibold" htmlFor="tallies-password">
                    Password
                  </label>
                  <input
                    id="tallies-password"
                    className="tallies-input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="submit" className="tallies-btn" disabled={busy !== null}>
                      {busy === "password" ? "Signing in…" : "Sign in"}
                    </button>
                    <button type="button" className="tallies-btn tallies-btn--quiet" disabled={busy !== null} onClick={() => setUsePassword(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="tallies-link mt-4 text-sm"
                  disabled={busy !== null}
                  onClick={() => {
                    setError(null);
                    setUsePassword(true);
                  }}
                >
                  Use email and password instead
                </button>
              )}
            </>
          )}
        </div>

        <p className="mt-5 text-center text-sm">
          <Link href="/" className="tallies-link">
            Back to Tallies
          </Link>
        </p>
      </div>
    </div>
  );
}
