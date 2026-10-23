// Spring 2026 metadata correction (tools/spring-2026-metadata.mjs) on the
// production-shaped fixture: dry run → guarded apply → verify → idempotent
// re-run → rollback. Never touches a real project.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { admin, clearFirestore, PROJECT_ID, seed } from "./support.mjs";
import { COACH_UID } from "../support/fixtures.mjs";
import { productionShapedSnapshot } from "../support/productionShapedFixture.mjs";
import { loadSnapshot, toJson } from "../../tools/identity/firestore.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spring-metadata-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(script, args, env = {}) {
  const res = spawnSync(process.execPath, [path.resolve("tools", script), ...args], {
    cwd: dir,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

const P = ["--project", PROJECT_ID];
const spring = async () => (await admin.doc("seasons/tigers-2026").get()).data();
const token = (out) => out.match(/updateTime (\d+\.\d{9})/)?.[1];
// Whole database minus the two corrected fields.
async function rest() {
  const s = toJson(await loadSnapshot(admin));
  delete s.exportedAt;
  const sp = s.seasons.find((x) => x.seasonId === "tigers-2026");
  delete sp.data.teamName;
  delete sp.data.seasonLabel;
  return JSON.stringify(s.seasons) + JSON.stringify(s.config);
}

before(async () => {
  await clearFirestore();
  await seed(productionShapedSnapshot(), [COACH_UID]);
});

test("refuses a real project without the production flag", () => {
  const r = run("spring-2026-metadata.mjs", ["--project", "baseball-coach-997ab"], { FIRESTORE_EMULATOR_HOST: "" });
  assert.equal(r.code, 2);
  assert.match(r.out, /Refusing to touch a real project/);
});

test("dry run, guarded apply, verify, idempotent re-run, rollback", async () => {
  const before = await spring();
  assert.equal(before.teamName, undefined);
  assert.equal(before.seasonLabel, undefined);
  const restBefore = await rest();

  const dry = run("spring-2026-metadata.mjs", P);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /Planned: set teamName="Tigers", seasonLabel="Spring 2026"/);
  const t = token(dry.out);
  assert.ok(t, dry.out);
  assert.equal((await spring()).teamName, undefined, "dry run writes nothing");

  const exp = run("export-firestore.mjs", [...P, "--out", "backup.json"]);
  assert.equal(exp.code, 0, exp.out);
  const noBackup = run("spring-2026-metadata.mjs", [...P, "--expect-update-time", t, "--apply"]);
  assert.equal(noBackup.code, 2);
  assert.match(noBackup.out, /requires --backup/);
  const noToken = run("spring-2026-metadata.mjs", [...P, "--backup", "backup.json", "--apply"]);
  assert.equal(noToken.code, 2);
  const stale = run("spring-2026-metadata.mjs", [...P, "--backup", "backup.json", "--expect-update-time", "1767225600.000000000", "--apply"]);
  assert.notEqual(stale.code, 0);
  assert.match(stale.out, /FAILED_PRECONDITION/);
  assert.equal((await spring()).teamName, undefined, "stale precondition writes nothing");

  const applied = run("spring-2026-metadata.mjs", [...P, "--backup", "backup.json", "--expect-update-time", t, "--apply"]);
  assert.equal(applied.code, 0, applied.out);
  assert.match(applied.out, /only teamName and seasonLabel were added/);
  const after = await spring();
  assert.equal(after.teamName, "Tigers");
  assert.equal(after.seasonLabel, "Spring 2026");
  assert.deepEqual(after["record.wins"], before["record.wins"], "legacy dotted fields kept");
  assert.equal(await rest(), restBefore, "nothing else changed");

  const again = run("spring-2026-metadata.mjs", P);
  assert.match(again.out, /Already applied/);

  const rollbackFile = fs.readdirSync(dir).find((f) => /^spring-2026-metadata-.*-rollback\.json$/.test(f));
  const rb = run("spring-2026-metadata.mjs", [...P, "--rollback", rollbackFile]);
  assert.equal(rb.code, 0, rb.out);
  const rolled = await spring();
  assert.equal(rolled.teamName, undefined);
  assert.equal(rolled.seasonLabel, undefined);
  assert.equal(await rest(), restBefore);
});

test("refuses when the fields already hold different values", async () => {
  await admin.doc("seasons/tigers-2026").set({ teamName: "Lions" }, { merge: true });
  const r = run("spring-2026-metadata.mjs", P);
  assert.equal(r.code, 3);
  assert.match(r.out, /Precondition failed: teamName already set/);
  assert.equal((await spring()).teamName, "Lions");
});
