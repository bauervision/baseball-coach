// DANGER: deletes every game and zeroes every player's stats in one season.
//
// Guarded (assessment D5): this script refuses to run unless it targets the
// local Firestore emulator, names the season explicitly, and confirms.
// It never reads service-account.json and cannot touch production.
//
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 //     node tools/reset-baseball-season.mjs --project demo-baseball-coach //       --season <seasonId> --yes-delete-all-games
//
// For production recovery use a reviewed, backed-up procedure instead.
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = arg("--project");
const seasonId = arg("--season");

if (!emulatorHost) {
  console.error(
    "Refusing to run: FIRESTORE_EMULATOR_HOST is not set. This script only runs against the local emulator.",
  );
  process.exit(2);
}
if (!projectId || !projectId.startsWith("demo-")) {
  console.error('Refusing to run: pass --project with a "demo-" emulator project id.');
  process.exit(2);
}
if (!seasonId) {
  console.error("Refusing to run: pass --season <seasonId> explicitly.");
  process.exit(2);
}
if (!process.argv.includes("--yes-delete-all-games")) {
  console.error(
    `Refusing to run: add --yes-delete-all-games to confirm deleting every game in ${seasonId}.`,
  );
  process.exit(2);
}

initializeApp({ projectId });
const db = getFirestore();

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