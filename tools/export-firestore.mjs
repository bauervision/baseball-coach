// Read-only JSON export of the whole database: every root collection and
// every subcollection, including "missing" parent documents that still have
// subcollections. This is the backup prerequisite for identity migration.
// It does not replace managed Firestore backups/PITR.
//
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 \
//     node tools/export-firestore.mjs --project demo-baseball-coach --out <dir>/backup.json
//
// --database <id> exports a named database instead of "(default)", e.g. an
// isolated restore-rehearsal database.
//
// Production (read-only) additionally requires --allow-production-read and
// Application Default Credentials. The file must be written outside this
// repository, is never overwritten, and gets a .sha256 alongside it. After
// writing, document counts are re-checked with server-side aggregation; a
// mismatch exits non-zero.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  arg,
  assertOutsideRepo,
  connect,
  loadSnapshot,
  toJson,
  treeCounts,
  verifyCounts,
} from "./identity/firestore.mjs";

try {
  const out = arg("--out");
  if (!out) throw new Error("Pass --out <file.json>.");
  const outAbs = path.resolve(out);
  assertOutsideRepo(outAbs);
  if (fs.existsSync(outAbs)) throw new Error(`${outAbs} already exists; choose a new file.`);

  const { db, projectId, databaseId, emulator } = connect({
    productionFlag: "--allow-production-read",
  });
  const raw = await loadSnapshot(db);
  const verification = await verifyCounts(db, raw);
  const snapshot = toJson(raw);
  snapshot.projectId = projectId;
  snapshot.databaseId = databaseId;
  snapshot.source = emulator ? "emulator" : "production";
  snapshot.verification = verification;

  const body = JSON.stringify(snapshot, null, 2);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, body, { flag: "wx" });
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  fs.writeFileSync(`${outAbs}.sha256`, `${sha}  ${path.basename(outAbs)}\n`, { flag: "wx" });

  // Counts only; never names or other child data.
  const counts = treeCounts(snapshot.raw);
  const missing = snapshot.seasons.filter((s) => s.parentMissing).map((s) => s.seasonId);
  console.log(`Exported ${projectId}/${databaseId} (${snapshot.source}) → ${outAbs}`);
  console.log(`sha256 ${sha}`);
  for (const [p, n] of Object.entries(counts).sort()) console.log(`  ${p}: ${n}`);
  if (missing.length) console.log(`Season docs missing but with data beneath: ${missing.join(", ")}`);
  for (const c of verification.checks) {
    console.log(`  verify ${c.path}: server ${c.server} / exported ${c.exported}${c.server === c.exported ? "" : "  MISMATCH"}`);
  }
  if (!verification.ok) {
    console.error("Count verification FAILED; do not rely on this export.");
    process.exit(5);
  }
  console.log("Count verification passed.");
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
