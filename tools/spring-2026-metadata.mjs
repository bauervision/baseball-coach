// Spring 2026 metadata correction: adds the two label fields the original
// season doc never had. Dry-run by default.
//
//   # 1. plan (no writes): prints the precondition and the doc's update time
//   node tools/spring-2026-metadata.mjs --project <id>
//   # 2. apply (requires a fresh export as backup; writes a rollback file first)
//   node tools/spring-2026-metadata.mjs --project <id> --backup export.json \
//     --expect-update-time <updateTime from step 1> --apply
//   # 3. undo
//   node tools/spring-2026-metadata.mjs --project <id> --rollback spring-2026-metadata-<ts>-rollback.json
//
// Writes only seasons/tigers-2026 { teamName, seasonLabel }, and only if
// both are absent and the doc is unchanged since the plan (lastUpdateTime
// precondition). Every other field and all subcollections are verified
// unchanged after apply. Real projects additionally require --allow-production.

import fs from "node:fs";
import path from "node:path";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { arg, assertOutsideRepo, connect, flag, loadSnapshot, toJson } from "./identity/firestore.mjs";

const SEASON = "seasons/tigers-2026";
const SET = { teamName: "Tigers", seasonLabel: "Spring 2026" };

// Everything except the two corrected fields, the doc's updateTime, and the
// export timestamp: must be identical before and after.
function digestWithout(snapshot) {
  const s = structuredClone(snapshot);
  delete s.exportedAt;
  for (const season of s.seasons ?? []) {
    if (season.seasonId === "tigers-2026") for (const k of Object.keys(SET)) delete season.data?.[k];
  }
  const walk = (docs) => {
    for (const d of docs ?? []) {
      if (d.id === "tigers-2026" && d.data) for (const k of Object.keys(SET)) delete d.data[k];
      for (const sub of Object.values(d.collections ?? {})) walk(sub);
    }
  };
  walk(s.raw?.seasons);
  return JSON.stringify(s);
}

async function rollback(db, file) {
  const { ops } = JSON.parse(fs.readFileSync(file, "utf8"));
  const ref = db.doc(SEASON);
  const snap = await ref.get();
  const cur = snap.data() ?? {};
  if (Object.entries(SET).some(([k, v]) => cur[k] !== v)) {
    throw new Error("Current values are not the ones this correction wrote; nothing rolled back.");
  }
  await ref.update(Object.fromEntries(ops.map((k) => [k, FieldValue.delete()])));
  console.log(`Rolled back ${ops.join(", ")} on ${SEASON}.`);
}

try {
  const { db, projectId } = connect({ productionFlag: "--allow-production" });

  const rollbackFile = arg("--rollback");
  if (rollbackFile) {
    await rollback(db, rollbackFile);
    process.exit(0);
  }

  const ref = db.doc(SEASON);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`${SEASON} does not exist; nothing to correct.`);
  const data = snap.data();
  const present = Object.keys(SET).filter((k) => k in data);
  // Exact token (seconds.nanoseconds); an ISO string would round microseconds.
  const updateTime = `${snap.updateTime.seconds}.${String(snap.updateTime.nanoseconds).padStart(9, "0")}`;
  console.log(`${SEASON} updateTime ${updateTime} (${snap.updateTime.toDate().toISOString()})`);
  if (present.length) {
    const already = present.every((k) => data[k] === SET[k]) && present.length === Object.keys(SET).length;
    console.log(already ? "Already applied; nothing to do." : `Precondition failed: ${present.join(", ")} already set; nothing written.`);
    process.exit(already ? 0 : 3);
  }
  console.log(`Planned: set ${Object.entries(SET).map(([k, v]) => `${k}="${v}"`).join(", ")} (both absent today).`);

  if (!flag("--apply")) {
    console.log("Dry run only. Re-run with --backup <export.json> --expect-update-time <updateTime> --apply to write.");
    process.exit(0);
  }

  const expected = arg("--expect-update-time");
  if (!/^\d+\.\d{9}$/.test(expected ?? "")) {
    throw new Error("--apply requires --expect-update-time <seconds.nanoseconds> exactly as the dry run printed it.");
  }
  const backupFile = arg("--backup");
  if (!backupFile || !fs.existsSync(backupFile)) {
    throw new Error("--apply requires --backup <export.json> from tools/export-firestore.mjs.");
  }
  const backup = JSON.parse(fs.readFileSync(backupFile, "utf8"));
  const ageHours = (Date.now() - Date.parse(backup.exportedAt)) / 3.6e6;
  if (backup.projectId !== projectId || !(ageHours < 24) || backup.verification?.ok !== true || !backup.raw) {
    throw new Error(`Backup must be a complete, verified export of ${projectId} from the last 24h.`);
  }

  const before = toJson(await loadSnapshot(db));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rollbackPath = path.join(path.dirname(path.resolve(backupFile)), `spring-2026-metadata-${stamp}-rollback.json`);
  assertOutsideRepo(rollbackPath);
  fs.writeFileSync(rollbackPath, JSON.stringify({ projectId, document: SEASON, ops: Object.keys(SET) }, null, 2));
  console.log(`Rollback file written: ${rollbackPath}`);

  // Fails (FAILED_PRECONDITION) if the doc changed after the dry run.
  const [sec, nanos] = expected.split(".").map(Number);
  await ref.update(SET, { lastUpdateTime: new Timestamp(sec, nanos) });

  const after = toJson(await loadSnapshot(db));
  const now = (await ref.get()).data();
  const fieldsOk = Object.entries(SET).every(([k, v]) => now[k] === v);
  const restSame = digestWithout(before) === digestWithout(after);
  if (!fieldsOk || !restSame) {
    console.error(`VERIFY FAILED (fields set ${fieldsOk}, all other data unchanged ${restSame}). Roll back with --rollback ${rollbackPath}`);
    process.exit(4);
  }
  console.log("Applied. Verified: only teamName and seasonLabel were added; all other data unchanged.");
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
