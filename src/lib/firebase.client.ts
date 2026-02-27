"use client";

import { initializeApp, getApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

type FirebaseClientCache = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
};

function getGlobalCache(): FirebaseClientCache | null {
  if (typeof window === "undefined") return null;
  const g = globalThis as unknown as {
    __BC_FIREBASE__?: FirebaseClientCache;
  };
  return g.__BC_FIREBASE__ ?? null;
}

function setGlobalCache(cache: FirebaseClientCache): void {
  if (typeof window === "undefined") return;
  const g = globalThis as unknown as {
    __BC_FIREBASE__?: FirebaseClientCache;
  };
  g.__BC_FIREBASE__ = cache;
}

function getFirebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth {
  const existing = getGlobalCache();
  if (existing) return existing.auth;

  const app = getFirebaseApp();
  const auth = getAuth(app);
  const db = getFirestore(app);

  setGlobalCache({ app, auth, db });
  return auth;
}

export function getFirestoreDb(): Firestore {
  const existing = getGlobalCache();
  if (existing) return existing.db;

  const app = getFirebaseApp();
  const auth = getAuth(app);
  const db = getFirestore(app);

  setGlobalCache({ app, auth, db });
  return db;
}

// Optional: if you want a stable exported app reference too.
export const firebaseApp: FirebaseApp = getFirebaseApp();

export { signInWithEmailAndPassword } from "firebase/auth";
export type { Auth } from "firebase/auth";