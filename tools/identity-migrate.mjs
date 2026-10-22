// Applies coach-approved identity links. Dry-run by default.
//
//   # 1. plan (no writes)
//   node tools/identity-migrate.mjs --project <id> --approvals audit/identity-approvals.json
//   # 2. apply (requires a fresh export as backup; writes a rollback file first)
//   node tools/identity-migrate.mjs --project <id> --approvals ... \
//     --backup backup.json --apply
//   # 3. undo
//   node tools/identity-migrate.mjs --project <id> --rollback identity-rollback-<ts>.json
//
// Writes only careerPlayerId / identityStatus / identityMigration on
// seasons/*/players/* docs. Stats, games, lines, awards, and layouts are
// verified unchanged after apply. Real projects additionally require
// --allow-production.
import fs from "node:fs";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { arg, connect, flag, loadSnapshot, toJson } from "./identity/firestore.mjs";
import {
  identityNeutralDigest,
  planMigration,
  statsDigest,
} from "./identity/audit.mjs";

const BATCH = 400;

async function commitOps(db, ops) {
  for (let i = 0; i < ops.length; i += BATCH) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + BATCH)) batch.set(db.doc(op.path), op.data, { merge: true });
    await batch.commit();
  }
}

async function rollback(db, file) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const ops = doc.ops.map((op) => ({
    path: op.path,
    data: {
      careerPlayerId: op.previous.careerPlayerId ?? FieldValue.delete(),
      identityStatus: op.previous.identityStatus ?? FieldValue.delete(),
      identityMigration: FieldValue.delete(),
    },
  }));
  await commitOps(db, ops);
  console.log(`Rolled back ${ops.length} roster entries from ${file}.`);
}

try {
  const { db, projectId } = connect({ productionFlag: "--allow-production" });

  const rollbackFile = arg("--rollback");
  if (rollbackFile) {
    await rollback(db, rollbackFile);
    process.exit(0);
  }

  const approvalsFile = arg("--approvals");
  if (!approvalsFile) throw new Error("Pass --approvals <identity-approvals.json>.");
  const approvals = JSON.parse(fs.readFileSync(approvalsFile, "utf8"));

  const before = toJson(await loadSnapshot(db));
  const plan = planMigration(before, approvals);
  if (!plan.ok) {
    console.error("Plan has errors; nothing written:\n  " + plan.errors.join("\n  "));
    process.exit(3);
  }
  console.log(`Planned updates: ${plan.ops.length} · already applied: ${plan.noops.length}`);
  for (const op of plan.ops) {
    console.log(`  ${op.path}: ${op.previous.careerPlayerId ?? "(none)"}/${op.previous.identityStatus ?? "unreviewed"} → ${op.set.careerPlayerId}/confirmed`);
  }

  if (!flag("--apply")) {
    console.log("Dry run only. Re-run with --backup <export.json> --apply to write.");
    process.exit(0);
  }
  if (plan.ops.length === 0) {
    console.log("Nothing to apply.");
    process.exit(0);
  }

  // Backup prerequisite: a recent export of this project with every season.
  const backupFile = arg("--backup");
  if (!backupFile || !fs.existsSync(backupFile)) {
    throw new Error("--apply requires --backup <export.json> from tools/export-firestore.mjs.");
  }
  const backup = JSON.parse(fs.readFileSync(backupFile, "utf8"));
  const ageHours = (Date.now() - Date.parse(backup.exportedAt)) / 3.6e6;
  const missing = before.seasons
    .map((s) => s.seasonId)
    .filter((id) => !backup.seasons?.some((b) => b.seasonId === id));
  if (backup.projectId !== projectId || !(ageHours < 24) || missing.length) {
    throw new Error(
      `Backup must be an export of ${projectId} from the last 24h covering every season (missing: ${missing.join(", ") || "none"}).`,
    );
  }
  if (backup.verification?.ok !== true || !backup.raw) {
    throw new Error("Backup must be a complete export whose count verification passed.");
  }

  const migrationId = `identity-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  // Next to the protected backup (outside the repo): paths embed child names.
  const rollbackPath = path.join(path.dirname(path.resolve(backupFile)), `${migrationId}-rollback.json`);
  fs.writeFileSync(
    rollbackPath,
    JSON.stringify({ migrationId, projectId, ops: plan.ops }, null, 2),
  );
  console.log(`Rollback file written: ${rollbackPath}`);

  await commitOps(
    db,
    plan.ops.map((op) => ({
      path: op.path,
      data: { ...op.set, identityMigration: migrationId },
    })),
  );

  // Verify: every op applied, plan now a no-op, stats/games untouched.
  const after = toJson(await loadSnapshot(db));
  const recheck = planMigration(after, approvals);
  const statsSame = statsDigest(before) === statsDigest(after);
  const restSame = identityNeutralDigest(before.raw) === identityNeutralDigest(after.raw);
  if (!recheck.ok || recheck.ops.length !== 0 || !statsSame || !restSame) {
    console.error(
      `VERIFY FAILED (remaining ops ${recheck.ops.length}, stats unchanged ${statsSame}, all other data unchanged ${restSame}). ` +
        `If the app was used during the migration this is expected; otherwise roll back with --rollback ${rollbackPath}`,
    );
    process.exit(4);
  }
  console.log(
    `Applied ${plan.ops.length} links (${migrationId}). Verified: stats and games unchanged; all other data unchanged except identity fields.`,
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
