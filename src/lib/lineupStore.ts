import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";

import type { SavedLineup } from "@/lib/lineup";

export const CURRENT_LINEUP_ID = "current";

type FirestoreSavedLineup = Omit<
  SavedLineup,
  "createdAtISO" | "updatedAtISO"
> & {
  createdAtISO?: string;
  updatedAtISO?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function lineupDoc(db: Firestore, seasonId: string) {
  return doc(db, "seasons", seasonId, "lineups", CURRENT_LINEUP_ID);
}

export async function loadCurrentLineup(
  db: Firestore,
  seasonId: string,
): Promise<SavedLineup | null> {
  const snap = await getDoc(lineupDoc(db, seasonId));

  if (!snap.exists()) return null;

  const data = snap.data() as FirestoreSavedLineup;

  return {
    id: data.id || CURRENT_LINEUP_ID,
    title: data.title || "Current Lineup",
    seasonId: data.seasonId || seasonId,
    inningCount: data.inningCount || 6,
    rows: Array.isArray(data.rows) ? data.rows : [],
    createdAtISO: data.createdAtISO || new Date().toISOString(),
    updatedAtISO: data.updatedAtISO || new Date().toISOString(),
  };
}

export async function saveCurrentLineup(
  db: Firestore,
  lineup: SavedLineup,
): Promise<void> {
  const now = new Date().toISOString();

  await setDoc(
    lineupDoc(db, lineup.seasonId),
    {
      ...lineup,
      id: CURRENT_LINEUP_ID,
      updatedAtISO: now,
      updatedAt: serverTimestamp(),
      createdAtISO: lineup.createdAtISO || now,
    },
    { merge: true },
  );
}
