// End-to-end identity migration rehearsal on emulator fixtures:
// export (backup) → audit → coach approval → dry run → apply → verify →
// idempotent re-run → rollback. Never touches a real project.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { admin, clearFirestore, PROJECT_ID, seed } from "./support.mjs";
import { COACH_UID, IDS, legacySnapshot } from "../support/fixtures.mjs";
import { statsDigest } from "../../tools/identity/audit.mjs";
import { loadSnapshot, toJson } from "../../tools/identity/firestore.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "identity-migration-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(script, args, env = {}) {
  const res = spawnSync(process.execPath, [path.resolve("tools", script), ...args], {
    cwd: dir,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

const status = async (seasonId, id) =>
  (await admin.doc(`seasons/${seasonId}/players/${id}`).get()).data();

before(async () => {
  await clearFirestore();
  await seed(legacySnapshot(), [COACH_UID]);
});

test("tools refuse real projects and missing safeguards", () => {
  const noEmu = run("identity-migrate.mjs", ["--project", "baseball-coach-997ab"], {
    FIRESTORE_EMULATOR_HOST: "",
  });
  assert.equal(noEmu.code, 2);
  assert.match(noEmu.out, /Refusing to touch a real project/);

  const wrongProject = run("export-firestore.mjs", ["--project", "baseball-coach-997ab", "--out", "x.json"]);
  assert.equal(wrongProject.code, 2);
  assert.match(wrongProject.out, /demo-/);
});

test("full rehearsal: audit, approve four returning players, apply, verify, roll back", async () => {
  const P = ["--project", PROJECT_ID];
  const historyBefore = statsDigest(toJson(await loadSnapshot(admin)));

  const exp = run("export-firestore.mjs", [...P, "--out", "backup.json"]);
  assert.equal(exp.code, 0, exp.out);

  const aud = run("identity-audit.mjs", [...P, "--out-dir", "audit"]);
  assert.equal(aud.code, 0, aud.out);
  for (const n of ["Ava Carter", "Ben Diaz", "Cole Evans", "Dana Fox"]) {
    assert.match(aud.out, new RegExp(`returning\\? ${n}`));
  }

  const approvalsPath = path.join(dir, "audit", "identity-approvals.json");
  const approvals = JSON.parse(fs.readFileSync(approvalsPath, "utf8"));
  assert.ok(approvals.approvals.every((a) => a.decision === "pending"));

  // Nothing approved yet → nothing to write.
  const pendingRun = run("identity-migrate.mjs", [...P, "--approvals", approvalsPath]);
  assert.match(pendingRun.out, /Planned updates: 0/);

  // Coach approves exactly the four returning players; Jordan Kim stays pending.
  for (const a of approvals.approvals) {
    if (["Ava Carter", "Ben Diaz", "Cole Evans", "Dana Fox"].includes(a.displayName)) {
      a.decision = "approve";
    }
  }
  fs.writeFileSync(approvalsPath, JSON.stringify(approvals));

  const dry = run("identity-migrate.mjs", [...P, "--approvals", approvalsPath]);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /Planned updates: 8/);
  assert.match(dry.out, /Dry run only/);
  assert.equal((await status("tigers-2026", "07-ava-carter")).identityStatus, undefined);

  const noBackup = run("identity-migrate.mjs", [...P, "--approvals", approvalsPath, "--apply"]);
  assert.equal(noBackup.code, 2);
  assert.match(noBackup.out, /requires --backup/);

  const applied = run("identity-migrate.mjs", [
    ...P, "--approvals", approvalsPath, "--backup", "backup.json", "--apply",
  ]);
  assert.equal(applied.code, 0, applied.out);
  assert.match(applied.out, /Verified: stats and games unchanged/);

  for (const [season, id, key] of [
    ["tigers-2026", "07-ava-carter", "ava"],
    ["tigers-fall-2026", "21-ben-diaz", "ben"],
    ["tigers-2026", "12-ben-diaz", "ben"],
  ]) {
    const d = await status(season, id);
    assert.equal(d.identityStatus, "confirmed");
    assert.equal(d.careerPlayerId, IDS[key]);
  }
  assert.equal((await status("tigers-fall-2026", "10-jordan-kim")).identityStatus, undefined);
  assert.equal(statsDigest(toJson(await loadSnapshot(admin))), historyBefore);

  const again = run("identity-migrate.mjs", [...P, "--approvals", approvalsPath]);
  assert.match(again.out, /Planned updates: 0 · already applied: 8/);

  const rollbackFile = fs.readdirSync(dir).find((f) => f.endsWith("-rollback.json"));
  const rb = run("identity-migrate.mjs", [...P, "--rollback", rollbackFile]);
  assert.equal(rb.code, 0, rb.out);
  const restored = await status("tigers-2026", "07-ava-carter");
  assert.equal(restored.identityStatus, undefined);
  assert.equal(restored.identityMigration, undefined);
  assert.equal(restored.careerPlayerId, IDS.ava);
  assert.equal(statsDigest(toJson(await loadSnapshot(admin))), historyBefore);
});

test("the guarded reset script refuses to run without explicit confirmation", () => {
  const res = run("reset-baseball-season.mjs", ["--project", PROJECT_ID, "--season", "tigers-2026"]);
  assert.equal(res.code, 2);
  assert.match(res.out, /--yes-delete-all-games/);
});
