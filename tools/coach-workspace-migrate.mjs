// Connects the ORIGINAL coach (existing Firebase uid) to the first coach
// workspace and records ownership on existing teams and seasons. Dry-run by
// default.
//
//   node tools/coach-workspace-migrate.mjs --project <id> --uid <verified uid> --email <owner email>
//   node tools/coach-workspace-migrate.mjs ... --backup export.json --apply
//   node tools/coach-workspace-migrate.mjs --project <id> --rollback coach-workspace-<ts>-rollback.json
//
// Safety:
// - The uid must already be the admins/{uid} allowlist doc (the verified
//   original coach); it is never derived from the email.
// - Idempotent: an existing coaches/{uid} record and its workspace are
//   reused; only missing ownership fields are added.
// - Writes: coachInvites/{id} (accepted, bound to uid, issuedBy
//   "migration"), coaches/{uid}, coachWorkspaces/{ws}; teams/*: ownerUid +
//   workspaceId; seasons/*: ownerUid. Nothing else changes (verified).
// - Refuses if any team/season already has a different owner.
// Real projects additionally require --allow-production.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FieldValue } from "firebase-admin/firestore";
import { arg, assertOutsideRepo, connect, flag, loadSnapshot, toJson } from "./identity/firestore.mjs";
import { statsDigest } from "./identity/audit.mjs";

export async function planWorkspace(db, uid, email) {
  const errors = [];
  if (!(await db.doc(`admins/${uid}`).get()).exists) errors.push("uid is not the admins/{uid} allowlist doc (not the verified original coach)");
  const coach = await db.doc(`coaches/${uid}`).get();
  const workspaceId = coach.exists ? coach.data().workspaceId : `ws_${crypto.randomBytes(12).toString("hex")}`;
  const ops = [];
  if (!coach.exists) {
    const inviteId = `inv_${crypto.randomBytes(10).toString("hex")}`;
    ops.push({ path: `coachInvites/${inviteId}`, create: { emailLower: String(email ?? "").trim().toLowerCase(), status: "accepted", boundUid: uid, issuedBy: "migration" } });
    ops.push({ path: `coachWorkspaces/${workspaceId}`, create: { ownerUid: uid, status: "active" } });
    ops.push({ path: `coaches/${uid}`, create: { workspaceId, inviteId, status: "active" } });
  }
  for (const t of (await db.collection("teams").get()).docs) {
    const d = t.data();
    if (d.ownerUid && d.ownerUid !== uid) errors.push(`teams/${t.id} belongs to another owner`);
    else if (!d.ownerUid || !d.workspaceId) ops.push({ path: `teams/${t.id}`, update: { ownerUid: uid, workspaceId } });
  }
  for (const s of (await db.collection("seasons").get()).docs) {
    const d = s.data();
    if (d.ownerUid && d.ownerUid !== uid) errors.push(`seasons/${s.id} belongs to another owner`);
    else if (!d.ownerUid) ops.push({ path: `seasons/${s.id}`, update: { ownerUid: uid } });
  }
  return { errors, ops, workspaceId };
}

async function main() {
  const { db, projectId } = connect({ productionFlag: "--allow-production" });
  const rollbackFile = arg("--rollback");
  if (rollbackFile) {
    const { ops } = JSON.parse(fs.readFileSync(rollbackFile, "utf8"));
    const batch = db.batch();
    for (const op of ops) {
      if (op.create) batch.delete(db.doc(op.path));
      else batch.update(db.doc(op.path), Object.fromEntries(Object.keys(op.update).map((k) => [k, FieldValue.delete()])));
    }
    await batch.commit();
    console.log(`Rolled back ${ops.length} writes from ${rollbackFile}.`);
    return;
  }

  const uid = arg("--uid");
  if (!uid) throw new Error("Pass --uid <verified original coach uid>.");
  const { errors, ops, workspaceId } = await planWorkspace(db, uid, arg("--email"));
  if (errors.length) {
    console.error("Plan has errors; nothing written:\n  " + errors.join("\n  "));
    process.exit(3);
  }
  console.log(`Workspace ${workspaceId} · planned writes: ${ops.length}`);
  for (const op of ops) console.log(`  ${op.create ? "create" : "update"} ${op.path} [${Object.keys(op.create ?? op.update).join(", ")}]`);
  if (!flag("--apply")) {
    console.log("Dry run only. Re-run with --backup <export.json> --apply to write.");
    return;
  }
  if (ops.length === 0) {
    console.log("Nothing to apply.");
    return;
  }
  const backupFile = arg("--backup");
  if (!backupFile || !fs.existsSync(backupFile)) throw new Error("--apply requires --backup <export.json> from tools/export-firestore.mjs.");
  const backup = JSON.parse(fs.readFileSync(backupFile, "utf8"));
  if (backup.projectId !== projectId || !((Date.now() - Date.parse(backup.exportedAt)) / 3.6e6 < 24) || backup.verification?.ok !== true) {
    throw new Error(`Backup must be a complete, verified export of ${projectId} from the last 24h.`);
  }
  const digestBefore = statsDigest(toJson(await loadSnapshot(db)));
  const id = `coach-workspace-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const rollbackPath = path.join(path.dirname(path.resolve(backupFile)), `${id}-rollback.json`);
  assertOutsideRepo(rollbackPath);
  fs.writeFileSync(rollbackPath, JSON.stringify({ id, projectId, ops }, null, 2));
  console.log(`Rollback file written: ${rollbackPath}`);

  const batch = db.batch();
  for (const op of ops) {
    if (op.create) {
      const ts = { createdAt: FieldValue.serverTimestamp(), ...(op.path.startsWith("coachInvites/") ? { acceptedAt: FieldValue.serverTimestamp() } : {}) };
      batch.create(db.doc(op.path), { ...op.create, ...ts });
    } else batch.update(db.doc(op.path), op.update);
  }
  await batch.commit();

  const again = await planWorkspace(db, uid, arg("--email"));
  const digestOk = statsDigest(toJson(await loadSnapshot(db))) === digestBefore;
  if (again.ops.length || again.errors.length || !digestOk) {
    console.error(`VERIFY FAILED (remaining ${again.ops.length}, stats unchanged ${digestOk}). Roll back with --rollback ${rollbackPath}`);
    process.exit(4);
  }
  console.log(`Applied ${ops.length} writes. Verified: re-plan empty; stats and games unchanged.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  });
}
