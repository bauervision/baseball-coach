// Persists a coach's recognition sheet arrangement on the season document:
//   seasons/{seasonId}.recognitionLayouts.{playerId} = { order, updatedAt }
// The season doc is already publicly readable (parents) and admin-writable,
// and every writer merges into it, so arrangements survive other season
// edits. Player docs are not used because roster rebuilds overwrite them.
"use client";

import {
  deleteField,
  doc,
  FieldPath,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";

function layoutPath(playerId: string): FieldPath {
  return new FieldPath("recognitionLayouts", playerId);
}

export async function saveRecognitionLayout(opts: {
  db: Firestore;
  seasonId: string;
  playerId: string;
  order: string[];
}): Promise<void> {
  const { db, seasonId, playerId, order } = opts;

  await updateDoc(
    doc(db, "seasons", seasonId),
    layoutPath(playerId),
    { order, updatedAt: serverTimestamp() },
  );
}

/** Returns the player to the automatic arrangement. */
export async function resetRecognitionLayout(opts: {
  db: Firestore;
  seasonId: string;
  playerId: string;
}): Promise<void> {
  const { db, seasonId, playerId } = opts;

  await updateDoc(doc(db, "seasons", seasonId), layoutPath(playerId), deleteField());
}
