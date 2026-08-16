"use client";

import * as React from "react";
import type { AppSession } from "@/lib/session";
import { onSessionChanged, readSession } from "@/lib/session";

type Role = AppSession["role"];

function CheckingAccess() {
  return (
    <div className="grid min-h-60 place-items-center rounded-3xl border p-6">
      <div className="text-sm font-semibold" style={{ color: "var(--muted)" }}>
        Checking access…
      </div>
    </div>
  );
}

export function ProtectedRoute(props: {
  children: React.ReactNode;
  allow?: Role[];
  fallback?: React.ReactNode;
  loadingFallback?: React.ReactNode;
}) {
  const {
    allow,
    fallback = null,
    loadingFallback = <CheckingAccess />,
    children,
  } = props;

  const [session, setSession] = React.useState<AppSession | null>(() =>
    readSession(),
  );
  const [ready, setReady] = React.useState(() => readSession() !== null);

  React.useEffect(() => {
    let alive = true;

    setSession(readSession());
    setReady(true);

    const unsub = onSessionChanged(() => {
      if (!alive) return;
      setSession(readSession());
      setReady(true);
    });

    const onFocus = () => {
      if (!alive) return;
      setSession(readSession());
      setReady(true);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      alive = false;
      unsub();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  if (!ready) return <>{loadingFallback}</>;

  if (!session) return <>{fallback}</>;

  if (allow && allow.length > 0 && !allow.includes(session.role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
