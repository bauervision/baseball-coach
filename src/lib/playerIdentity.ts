import { collection, getDocs, type Firestore } from "firebase/firestore";

export function newCareerPlayerId(): string {
  return globalThis.crypto.randomUUID();
}

export async function findHistoricalCareerPlayerId(opts: {
  db: Firestore;
  playerName: string;
  currentSeasonId: string;
}): Promise<string | null> {
  const { db, playerName, currentSeasonId } = opts;
  const normalizedName = playerName.trim().toLowerCase();
  if (!normalizedName) return null;

  const seasonsSnap = await getDocs(collection(db, "seasons"));

  for (const seasonDoc of seasonsSnap.docs) {
    if (seasonDoc.id === currentSeasonId) continue;

    const playersSnap = await getDocs(
      collection(db, "seasons", seasonDoc.id, "players"),
    );

    const match = playersSnap.docs.find((playerDoc) => {
      const name = playerDoc.data().name;
      return (
        typeof name === "string" && name.trim().toLowerCase() === normalizedName
      );
    });

    if (!match) continue;

    const careerPlayerId = match.data().careerPlayerId;
    if (typeof careerPlayerId === "string" && careerPlayerId.trim()) {
      return careerPlayerId.trim();
    }
  }

  return null;
}
