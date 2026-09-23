import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Firestore,
  type Unsubscribe,
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

function parseSavedLineup(
  seasonId: string,
  data: FirestoreSavedLineup,
): SavedLineup {
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

// Live-subscribes to the current lineup so callers (e.g. Stat Update, while
// entering a not-yet-saved game) reflect edits made on the Lineup tab
// without a page reload. Single-document listener only — no per-player reads.
export function subscribeCurrentLineup(
  db: Firestore,
  seasonId: string,
  onChange: (lineup: SavedLineup | null) => void,
): Unsubscribe {
  return onSnapshot(lineupDoc(db, seasonId), (snap) => {
    if (!snap.exists()) {
      onChange(null);
      return;
    }
    onChange(parseSavedLineup(seasonId, snap.data() as FirestoreSavedLineup));
  });
}

export async function loadCurrentLineup(
  db: Firestore,
  seasonId: string,
): Promise<SavedLineup | null> {
  const snap = await getDoc(lineupDoc(db, seasonId));

  if (!snap.exists()) return null;

  return parseSavedLineup(seasonId, snap.data() as FirestoreSavedLineup);
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
