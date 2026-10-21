// Read-only JSON export of app/config and every season (players, games,
// lines, lineups). This is the backup prerequisite for identity migration.
// It does not replace managed Firestore backups/PITR, which must still be
// confirmed in the Firebase console.
//
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//     node tools/export-firestore.mjs --project demo-baseball-coach --out backup.json
//
// Production (read-only) requires --allow-production-read and ADC.
import fs from "node:fs";
import { arg, connect, loadSnapshot, toJson } from "./identity/firestore.mjs";

try {
  const out = arg("--out");
  if (!out) throw new Error("Pass --out <file.json>.");
  if (fs.existsSync(out)) throw new Error(`${out} already exists; choose a new file.`);

  const { db, projectId } = connect({ productionFlag: "--allow-production-read" });
  const snapshot = toJson(await loadSnapshot(db));
  snapshot.projectId = projectId;
  fs.writeFileSync(out, JSON.stringify(snapshot, null, 2));

  const players = snapshot.seasons.reduce((n, s) => n + s.players.length, 0);
  const games = snapshot.seasons.reduce((n, s) => n + s.games.length, 0);
  console.log(
    `Exported ${snapshot.seasons.length} seasons, ${players} roster entries, ${games} games to ${out}.`,
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
