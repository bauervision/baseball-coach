// lib/firebase.client.ts
"use client";

import { initializeApp, getApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

function getMissingConfig(): string[] {
  const entries = [
    ["NEXT_PUBLIC_FIREBASE_API_KEY", firebaseConfig.apiKey],
    ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", firebaseConfig.authDomain],
    ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", firebaseConfig.projectId],
    ["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", firebaseConfig.storageBucket],
    [
      "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
      firebaseConfig.messagingSenderId,
    ],
    ["NEXT_PUBLIC_FIREBASE_APP_ID", firebaseConfig.appId],
  ] as const;

  return entries.filter(([, value]) => !value).map(([key]) => key);
}

export function hasFirebaseClientConfig(): boolean {
  return getMissingConfig().length === 0;
}

function assertClientConfig() {
  const missing = getMissingConfig();
  if (missing.length > 0) {
    throw new Error(`Missing Firebase client config: ${missing.join(", ")}`);
  }
}

type FirebaseClientCache = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
};

function getGlobalCache(): FirebaseClientCache | null {
  if (typeof window === "undefined") return null;
  const g = globalThis as unknown as { __BC_FIREBASE__?: FirebaseClientCache };
  return g.__BC_FIREBASE__ ?? null;
}

function setGlobalCache(cache: FirebaseClientCache): void {
  if (typeof window === "undefined") return;
  const g = globalThis as unknown as { __BC_FIREBASE__?: FirebaseClientCache };
  g.__BC_FIREBASE__ = cache;
}

function getFirebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

function createFirestore(app: FirebaseApp): Firestore {
  return initializeFirestore(app, {
    localCache: memoryLocalCache(),
    experimentalForceLongPolling: true,
  });
}

export function getFirebaseAuth(): Auth {
  const existing = getGlobalCache();
  if (existing) return existing.auth;

  assertClientConfig();

  const app = getFirebaseApp();
  const auth = getAuth(app);
  const db = createFirestore(app);

  setGlobalCache({ app, auth, db });
  return auth;
}

export function getFirestoreDb(): Firestore {
  const existing = getGlobalCache();
  if (existing) return existing.db;

  assertClientConfig();

  const app = getFirebaseApp();
  const auth = getAuth(app);
  const db = createFirestore(app);

  setGlobalCache({ app, auth, db });
  return db;
}

export const firebaseApp: FirebaseApp = getFirebaseApp();
export { signInWithEmailAndPassword } from "firebase/auth";
export type { Auth } from "firebase/auth";
