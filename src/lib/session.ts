import { storageKey } from "@/lib/storage";

export type AppRole = "public" | "admin";

export type AppSession = {
  role: AppRole;
  name?: string;
  email?: string;
  uid?: string;
};

const KEY = storageKey("session");
const SESSION_EVENT = "bv:session";

function normalizeEmail(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

export function getConfiguredAdminEmails(): string[] {
  const raw =
    process.env.NEXT_PUBLIC_ADMIN_EMAILS ??
    process.env.NEXT_PUBLIC_ADMIN_EMAIL ??
    "";

  return Array.from(
    new Set(
      raw
        .split(/[;,\s]+/)
        .map((entry) => normalizeEmail(entry))
        .filter(Boolean),
    ),
  );
}

function isValidAdminSession(session: Partial<AppSession> | null): boolean {
  if (!session || session.role !== "admin") return false;

  const allowlist = getConfiguredAdminEmails();
  if (allowlist.length === 0) return false;

  const email = normalizeEmail(session.email);
  return email.length > 0 && allowlist.includes(email);
}

export function sanitizeSession(
  session: Partial<AppSession> | null,
): AppSession | null {
  if (!session || !session.role) return null;

  if (session.role === "public") {
    return {
      role: "public",
      name: session.name ?? "Parent",
    };
  }

  if (session.role === "admin" && isValidAdminSession(session)) {
    return {
      role: "admin",
      name: session.name ?? "Admin",
      email: normalizeEmail(session.email),
      uid: session.uid,
    };
  }

  return null;
}

function emitSessionChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function onSessionChanged(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SESSION_EVENT, cb);
  return () => window.removeEventListener(SESSION_EVENT, cb);
}

export function readSession(): AppSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppSession>;
    return sanitizeSession(parsed);
  } catch {
    return null;
  }
}

export function writeSession(session: AppSession) {
  const safeSession = sanitizeSession(session);
  if (!safeSession || typeof window === "undefined") return;

  window.localStorage.setItem(KEY, JSON.stringify(safeSession));
  emitSessionChanged();
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  emitSessionChanged();
}
