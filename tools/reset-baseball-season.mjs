import { initializeApp, cert } from "firebase-admin/app";
import {
  getFirestore,
  FieldValue,
} from "firebase-admin/firestore";
import fs from "node:fs";

const serviceAccount = JSON.parse(
  fs.readFileSync("./service-account.json", "utf8"),
);

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();
const seasonId = "tigers-2026";

const EMPTY_STATS = {
  games: 0,
  plateAppearances: 0,
  atBats: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  runs: 0,
  rbi: 0,
  walks: 0,
  strikeouts: 0,
  hitByPitch: 0,
  putOuts: 0,
  assists: 0,
};

async function deleteCollection(path) {
  const snap = await db.collection(path).get();
  if (snap.empty) return;

  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

async function main() {
  console.log(`Resetting season: ${seasonId}`);

  // Reset season record
  await db.doc(`seasons/${seasonId}`).set(
    {
      record: { wins: 0, losses: 0, ties: 0 },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // Delete all games
  const gamesSnap = await db.collection(`seasons/${seasonId}/games`).get();
  for (const gameDoc of gamesSnap.docs) {
    await deleteCollection(`seasons/${seasonId}/games/${gameDoc.id}/lines`);
    await gameDoc.ref.delete();
    console.log(`Deleted game ${gameDoc.id}`);
  }

  // Reset players
  const playersSnap = await db.collection(`seasons/${seasonId}/players`).get();

  for (const playerDoc of playersSnap.docs) {
    await playerDoc.ref.set(
      {
        stats: EMPTY_STATS,
        updatedAt: FieldValue.serverTimestamp(),

        // remove broken top-level dotted leftovers
        ["stats.games"]: FieldValue.delete(),
        ["stats.plateAppearances"]: FieldValue.delete(),
        ["stats.atBats"]: FieldValue.delete(),
        ["stats.hits"]: FieldValue.delete(),
        ["stats.doubles"]: FieldValue.delete(),
        ["stats.triples"]: FieldValue.delete(),
        ["stats.homeRuns"]: FieldValue.delete(),
        ["stats.runs"]: FieldValue.delete(),
        ["stats.rbi"]: FieldValue.delete(),
        ["stats.walks"]: FieldValue.delete(),
        ["stats.strikeouts"]: FieldValue.delete(),
        ["stats.hitByPitch"]: FieldValue.delete(),
        ["stats.putOuts"]: FieldValue.delete(),
        ["stats.assists"]: FieldValue.delete(),
      },
      { merge: true },
    );

    console.log(`Reset player ${playerDoc.id}`);
  }

  console.log("Season reset complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});