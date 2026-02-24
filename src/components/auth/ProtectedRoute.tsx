"use client";

import * as React from "react";
import type { AppSession } from "@/lib/session";
import { readSession, onSessionChanged } from "@/lib/session";

type Role = AppSession["role"];

export function ProtectedRoute(props: {
  children: React.ReactNode;
  allow?: Role[]; // omit => any signed-in user
  fallback?: React.ReactNode; // omit => null
}) {
  const { allow, fallback = null, children } = props;

  const [session, setSession] = React.useState<AppSession | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setSession(readSession());
    setReady(true);

    const unsub = onSessionChanged(() => {
      setSession(readSession());
    });

    return () => {
      unsub();
    };
  }, []);

  if (!ready) return null;

  if (!session) return <>{fallback}</>;

  if (allow && allow.length > 0 && !allow.includes(session.role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}