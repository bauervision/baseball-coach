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
    return JSON.parse(raw) as AppSession;
  } catch {
    return null;
  }
}

export function writeSession(session: AppSession) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(session));
  emitSessionChanged();
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  emitSessionChanged();
}