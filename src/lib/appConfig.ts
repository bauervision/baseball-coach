// lib/appConfig.ts
"use client";


import { getFirestoreDb } from "@/lib/firebase.client";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

function appConfigDoc() {
  const db = getFirestoreDb();
  return doc(db, "app", "config");
}

export async function readCurrentSeasonId(): Promise<string | null> {
  const snap = await getDoc(appConfigDoc());
  if (!snap.exists()) return null;

  const data = snap.data() as { currentSeasonId?: unknown };
  const v = data.currentSeasonId;

  return typeof v === "string" && v.trim().length ? v.trim() : null;
}

export async function writeCurrentSeasonId(seasonId: string) {
  const sid = seasonId.trim();
  if (!sid) throw new Error("seasonId is required");

  await setDoc(
    appConfigDoc(),
    { currentSeasonId: sid, updatedAt: serverTimestamp() },
    { merge: true },
  );
}