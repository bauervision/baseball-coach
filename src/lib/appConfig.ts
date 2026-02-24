import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { firestore } from "@/lib/firebase";

export const APP_CONFIG_DOC = doc(firestore, "app", "config");

export async function readCurrentSeasonId(): Promise<string | null> {
  const snap = await getDoc(APP_CONFIG_DOC);
  if (!snap.exists()) return null;
  const data = snap.data() as { currentSeasonId?: unknown };
  return typeof data.currentSeasonId === "string" && data.currentSeasonId.length
    ? data.currentSeasonId
    : null;
}

export async function writeCurrentSeasonId(seasonId: string) {
  await setDoc(
    APP_CONFIG_DOC,
    { currentSeasonId: seasonId, updatedAt: serverTimestamp() },
    { merge: true },
  );
}