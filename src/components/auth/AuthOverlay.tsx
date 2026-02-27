"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { AppSession } from "@/lib/session";
import { readSession, writeSession, onSessionChanged } from "@/lib/session";
import {
  startErrorOverlay,
  finishErrorOverlay,
  startEnterOverlay,
  finishEnterOverlay,
} from "@/components/layout/AuthOverlayHost";

import {
  getFirebaseAuth,
  signInWithEmailAndPassword,
  type Auth,
} from "@/lib/firebase.client";

type PendingKind = "enter" | null;

const OVERLAY_MS = 2000;

export function AuthOverlay(props: { children: React.ReactNode }) {
  const router = useRouter();
  const [auth, setAuth] = React.useState<Auth | null>(null);

  React.useEffect(() => {
    // client-only
    setAuth(getFirebaseAuth());
  }, []);


  const [ready, setReady] = React.useState(false);
  const [session, setSession] = React.useState<AppSession | null>(null);
  const [pending, setPending] = React.useState<PendingKind>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [adminOpen, setAdminOpen] = React.useState(false);
  const [adminEmail, setAdminEmail] = React.useState("");
  const [adminPassword, setAdminPassword] = React.useState("");
  const [adminBusy, setAdminBusy] = React.useState(false);
  const [adminError, setAdminError] = React.useState<string | null>(null);

  const timersRef = React.useRef<number[]>([]);

  React.useEffect(() => {
    setSession(readSession());
    setReady(true);

    const unsub = onSessionChanged(() => {
      setSession(readSession());
    });

    return () => {
      unsub();
      for (const id of timersRef.current) window.clearTimeout(id);
      timersRef.current = [];
    };
  }, []);

  const onSignIn = React.useCallback(
    async (next: AppSession) => {
      if (pending) return;

      setError(null);
      setPending("enter");
      startEnterOverlay();

      const minDelay = new Promise<void>((resolve) => {
        const t = window.setTimeout(() => resolve(), OVERLAY_MS);
        timersRef.current.push(t);
      });

      try {
        const result = await attemptSignIn(next);

        await minDelay;

        if (!result.ok) {
          setError(result.message ?? "Sign-in failed.");

          startErrorOverlay();

          const t = window.setTimeout(() => {
            finishErrorOverlay();
            finishEnterOverlay();
            setPending(null);
          }, 700);

          timersRef.current.push(t);
          return;
        }

        writeSession(result.session);

        finishEnterOverlay();
        setPending(null);
      } catch {
        await minDelay;
        setError("Sign-in failed.");
        finishEnterOverlay();
        setPending(null);
      }
    },
    [pending],
  );

  const onEnterPublic = React.useCallback(async () => {
    if (pending) return;

    setError(null);
    setPending("enter");
    startEnterOverlay();

    const minDelay = new Promise<void>((resolve) => {
      const t = window.setTimeout(() => resolve(), OVERLAY_MS);
      timersRef.current.push(t);
    });

    try {
      await minDelay;

      writeSession({ role: "public", name: "Parent" });

      finishEnterOverlay();
      setPending(null);

      // Parents land on the real home page.
      router.replace("/");
    } catch {
      await minDelay;
      finishEnterOverlay();
      setPending(null);
    }
  }, [pending, router]);

  function friendlyAuthError(err: unknown): string {
    const code =
      typeof (err as { code?: unknown })?.code === "string"
        ? (err as { code: string }).code
        : "";

    switch (code) {
      case "auth/invalid-email":
        return "That email address doesn’t look valid.";
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Incorrect email or password.";
      case "auth/too-many-requests":
        return "Too many attempts. Try again in a bit.";
      case "auth/network-request-failed":
        return "Network error. Check your connection and try again.";
      default:
        return "Login failed. Please try again.";
    }
  }

  const onAdminLogin = React.useCallback(async () => {
    if (pending || adminBusy) return;

    setAdminError(null);
    setError(null);

    const email = adminEmail.trim();
    const password = adminPassword;

    if (!email || !password) {
      setAdminError("Enter your email and password.");
      return;
    }

    setAdminBusy(true);
    setPending("enter");
    startEnterOverlay();

    const minDelay = new Promise<void>((resolve) => {
      const t = window.setTimeout(() => resolve(), OVERLAY_MS);
      timersRef.current.push(t);
    });

    if (!auth) return;

    try {
      const credPromise = signInWithEmailAndPassword(auth, email, password);

      const [cred] = await Promise.all([credPromise, minDelay]);

      writeSession({
        role: "admin",
        name: cred.user.displayName ?? "Admin",
        email: cred.user.email ?? email,
        uid: cred.user.uid,
      });

      finishEnterOverlay();
      setPending(null);
      setAdminBusy(false);
      setAdminOpen(false);

      router.replace("/admin");
    } catch (e) {
      await minDelay;

      setAdminError(friendlyAuthError(e));

      startErrorOverlay();
      const t = window.setTimeout(() => {
        finishErrorOverlay();
        finishEnterOverlay();
        setPending(null);
        setAdminBusy(false);
      }, 700);
      timersRef.current.push(t);
    }
  }, [pending, adminBusy, adminEmail, adminPassword, router, auth]);

  if (!ready) return null;

  const showApp = session !== null && pending !== "enter";
  const showAuth = !showApp;

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        {showApp ? (
          <motion.div
            key="app"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {props.children}
          </motion.div>
        ) : (
          <motion.div
            key="auth"
            className="min-h-dvh"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{
              background: "var(--bg-base)",
              color: "var(--foreground)",
            }}
          >
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(circle at 15% 20%, color-mix(in oklab, var(--secondary) 18%, transparent), transparent 55%), radial-gradient(circle at 85% 70%, color-mix(in oklab, var(--primary) 14%, transparent), transparent 60%)",
                opacity: 0.9,
              }}
            />

            <div className="relative min-h-dvh grid place-items-center px-4">
              <div className="w-full max-w-sm">
                {/* Header above card */}
                <motion.div
                  className="mb-5 text-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22 }}
                >
                  <div
                    className="text-3xl font-extrabold tracking-[0.18em]"
                    style={{
                      color:
                        "color-mix(in oklab, var(--foreground) 90%, white 10%)",
                      textTransform: "uppercase",
                    }}
                  >
                    Tigers
                  </div>
                  <div
                    className="mt-1 text-xl"
                    style={{ color: "var(--muted)" }}
                  >
                    Spring 2026
                  </div>
                </motion.div>

                <motion.div
                  className="w-full rounded-2xl border p-6 shadow-2xl backdrop-blur"
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.985 }}
                  transition={{ duration: 0.22 }}
                  style={{
                    borderColor:
                      "color-mix(in oklab, var(--primary) 92%, transparent)",
                    background:
                      "linear-gradient(180deg, color-mix(in oklab, var(--card) 92%, var(--bg-base) 8%), var(--card))",
                    boxShadow:
                      "0 30px 90px rgba(0,0,0,0.35), 0 0 0 1px color-mix(in oklab, var(--primary) 10%, transparent) inset",
                  }}
                >
                  <div className="text-lg font-semibold">Sign In</div>
                  <div
                    className="mt-2 text-sm"
                    style={{ color: "var(--muted)" }}
                  >
                    Prototype session gate (replace with real auth per app).
                  </div>

                  {error ? (
                    <div
                      className="mt-4 rounded-lg border px-3 py-2 text-xs"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--accent-2) 45%, transparent)",
                        background:
                          "color-mix(in oklab, var(--accent-2) 18%, transparent)",
                        color:
                          "color-mix(in oklab, var(--foreground) 90%, white 10%)",
                        boxShadow:
                          "0 0 0 1px color-mix(in oklab, var(--accent-2) 18%, transparent) inset",
                      }}
                    >
                      {error}
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-col gap-3">
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void onEnterPublic()}
                      className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{
                        background:
                          "linear-gradient(90deg, var(--primary), var(--secondary))",
                        color: "black",
                      }}
                    >
                      Enter Parent Portal
                    </button>

                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => {
                        setAdminError(null);
                        setAdminOpen(true);
                      }}
                      className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 92%, transparent)",
                        background:
                          "color-mix(in oklab, var(--bg-base) 70%, transparent)",
                        color:
                          "color-mix(in oklab, var(--foreground) 78%, transparent)",
                      }}
                    >
                      Coach Login
                    </button>
                  </div>

                  {adminOpen ? (
                    <div
                      className="mt-4 rounded-xl border p-3"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 92%, transparent)",
                        background:
                          "color-mix(in oklab, var(--bg-base) 80%, transparent)",
                      }}
                    >
                      <div className="text-sm font-semibold">Coach Login</div>

                      <div className="mt-3 flex flex-col gap-2">
                        <input
                          value={adminEmail}
                          onChange={(e) => setAdminEmail(e.target.value)}
                          placeholder="Email"
                          inputMode="email"
                          autoComplete="email"
                          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                          style={{
                            borderColor:
                              "color-mix(in oklab, var(--stroke) 92%, transparent)",
                            background:
                              "color-mix(in oklab, var(--card) 92%, transparent)",
                            color: "var(--foreground)",
                          }}
                        />
                        <input
                          value={adminPassword}
                          onChange={(e) => setAdminPassword(e.target.value)}
                          placeholder="Password"
                          type="password"
                          autoComplete="current-password"
                          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                          style={{
                            borderColor:
                              "color-mix(in oklab, var(--stroke) 92%, transparent)",
                            background:
                              "color-mix(in oklab, var(--card) 92%, transparent)",
                            color: "var(--foreground)",
                          }}
                        />

                        {adminError ? (
                          <div
                            className="rounded-lg border px-3 py-2 text-xs"
                            style={{
                              borderColor:
                                "color-mix(in oklab, var(--accent-2) 45%, transparent)",
                              background:
                                "color-mix(in oklab, var(--accent-2) 18%, transparent)",
                            }}
                          >
                            {adminError}
                          </div>
                        ) : null}

                        <div className="mt-1 flex gap-2">
                          <button
                            type="button"
                            disabled={adminBusy || pending !== null}
                            onClick={() => void onAdminLogin()}
                            className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                            style={{
                              background:
                                "linear-gradient(90deg, var(--primary), var(--secondary))",
                              color: "black",
                            }}
                          >
                            Sign In
                          </button>

                          <button
                            type="button"
                            disabled={adminBusy || pending !== null}
                            onClick={() => setAdminOpen(false)}
                            className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                            style={{
                              borderColor:
                                "color-mix(in oklab, var(--stroke) 92%, transparent)",
                              background: "transparent",
                              color: "var(--foreground)",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {pending === "enter" ? (
                    <div
                      className="mt-5 flex items-center gap-3 rounded-xl border px-3 py-2"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 92%, transparent)",
                        background:
                          "color-mix(in oklab, var(--bg-base) 70%, transparent)",
                      }}
                    >
                      <div
                        className="tigersLoadingLogo h-8 w-8 shrink-0"
                        aria-hidden="true"
                        style={{
                          background: "var(--primary)",
                          WebkitMaskImage: 'url("/TigersLogo.png")',
                          maskImage: 'url("/TigersLogo.png")',
                          WebkitMaskRepeat: "no-repeat",
                          maskRepeat: "no-repeat",
                          WebkitMaskPosition: "center",
                          maskPosition: "center",
                          WebkitMaskSize: "contain",
                          maskSize: "contain",
                          filter:
                            "drop-shadow(0 10px 18px color-mix(in oklab, var(--bg-base) 70%, transparent))",
                        }}
                      />

                      <div className="min-w-0">
                        <div
                          className="text-xs font-semibold"
                          style={{ color: "var(--foreground)" }}
                        >
                          Loading roster…
                        </div>
                        <div
                          className="text-[11px]"
                          style={{ color: "var(--muted)" }}
                        >
                          Syncing team stats and lineup
                        </div>
                      </div>

                      <div
                        className="ml-auto flex items-center gap-1.5"
                        aria-hidden="true"
                      >
                        <span className="dot" />
                        <span className="dot dot2" />
                        <span className="dot dot3" />
                      </div>

                      <style jsx>{`
                        .dot {
                          width: 6px;
                          height: 6px;
                          border-radius: 999px;
                          background: color-mix(
                            in oklab,
                            var(--primary) 70%,
                            white 30%
                          );
                          opacity: 0.35;
                          animation: pulse 900ms ease-in-out infinite;
                        }
                        .dot2 {
                          animation-delay: 140ms;
                        }
                        .dot3 {
                          animation-delay: 280ms;
                        }
                        @keyframes pulse {
                          0%,
                          100% {
                            transform: translateY(0px);
                            opacity: 0.25;
                          }
                          50% {
                            transform: translateY(-2px);
                            opacity: 0.85;
                          }
                        }

                        .tigersLoadingLogo {
                          animation: sweep 650ms cubic-bezier(0.2, 0.9, 0.2, 1)
                            both;
                        }
                        @keyframes sweep {
                          from {
                            transform: translateX(-10px);
                            opacity: 0;
                            filter: blur(2px);
                          }
                          to {
                            transform: translateX(0px);
                            opacity: 1;
                            filter: blur(0px);
                          }
                        }
                      `}</style>
                    </div>
                  ) : null}
                </motion.div>

                {/* Big Tigers logo below card */}
                <motion.div
                  className="mt-6 grid place-items-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.05 }}
                  aria-hidden="true"
                >
                  <div
                    className="authBigTigersLogo h-48 w-48"
                    style={{
                      background: "var(--primary)",
                      WebkitMaskImage: 'url("/TigersLogo.png")',
                      maskImage: 'url("/TigersLogo.png")',
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                      WebkitMaskPosition: "center",
                      maskPosition: "center",
                      WebkitMaskSize: "contain",
                      maskSize: "contain",
                      filter:
                        "drop-shadow(0 26px 70px rgba(0,0,0,0.55)) drop-shadow(0 0 1px rgba(255,255,255,0.10))",
                      opacity: 0.95,
                    }}
                  />

                  <style jsx>{`
                    .authBigTigersLogo {
                      animation: bigLogoFloat 3.6s ease-in-out infinite;
                    }
                    @keyframes bigLogoFloat {
                      0%,
                      100% {
                        transform: translateY(0px);
                        opacity: 0.9;
                      }
                      50% {
                        transform: translateY(-6px);
                        opacity: 1;
                      }
                    }
                  `}</style>
                </motion.div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

type SignInResult =
  | { ok: true; session: AppSession }
  | { ok: false; message?: string };

async function attemptSignIn(next: AppSession): Promise<SignInResult> {
  const SHOULD_FAIL = false;

  await new Promise((r) => setTimeout(r, 350));

  if (SHOULD_FAIL) {
    return { ok: false, message: "Invalid credentials (simulated)." };
  }

  return { ok: true, session: next };
}
