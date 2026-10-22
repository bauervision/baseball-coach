// Backup completeness and restore rehearsal on emulator fixtures:
// export → verify counts → restore into the emulator → re-export → identical.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GeoPoint } from "firebase-admin/firestore";

import { admin, clearFirestore, PROJECT_ID, seed } from "./support.mjs";
import { COACH_UID, legacySnapshot } from "../support/fixtures.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-restore-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const P = ["--project", PROJECT_ID];

function run(script, args, env = {}) {
  const res = spawnSync(process.execPath, [path.resolve("tools", script), ...args], {
    cwd: dir,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

before(async () => {
  await clearFirestore();
  await seed(legacySnapshot(), [COACH_UID]);
  // A season whose doc was deleted/overwritten but whose roster survived:
  // invisible to collection("seasons").get(), must still be exported.
  await admin.doc("seasons/ghost-2025/players/p1").set({ name: "Fixture Kid", number: 1 });
  // An unexpected subcollection and special field types.
  await admin.doc("seasons/tigers-2026/notes/n1").set({
    ref: admin.doc("seasons/tigers-fall-2026"),
    where: new GeoPoint(40.1, -75.2),
    blob: Buffer.from([1, 2, 3]),
  });
});

test("export captures every collection, missing parents, and verifies counts", () => {
  const res = run("export-firestore.mjs", [...P, "--out", "export-1.json"]);
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /Count verification passed/);
  assert.match(res.out, /Season docs missing but with data beneath: ghost-2025/);
  assert.doesNotMatch(res.out, /Ava|Ben|Fixture Kid/, "no child names in output");

  const snap = read("export-1.json");
  const ghost = snap.seasons.find((s) => s.seasonId === "ghost-2025");
  assert.equal(ghost.parentMissing, true);
  assert.equal(ghost.players.length, 1);
  assert.deepEqual(
    snap.seasons.find((s) => s.seasonId === "tigers-2026").otherSubcollections,
    ["notes"],
  );
  assert.ok(Object.keys(snap.raw).includes("admins"), "all root collections");
  assert.ok(fs.existsSync(path.join(dir, "export-1.json.sha256")));
});

test("exports refuse the repository, overwrites, and real projects without the flag", () => {
  const inRepo = run("export-firestore.mjs", [...P, "--out", path.resolve("x-export.json")]);
  assert.equal(inRepo.code, 2);
  assert.match(inRepo.out, /outside the repository/);
  const auditInRepo = run("identity-audit.mjs", ["--from-json", "export-1.json", "--out-dir", path.resolve("audit-x")]);
  assert.equal(auditInRepo.code, 2);
  assert.ok(!fs.existsSync(path.resolve("audit-x")));
  assert.ok(!fs.existsSync(path.resolve("x-export.json")));

  const again = run("export-firestore.mjs", [...P, "--out", "export-1.json"]);
  assert.match(again.out, /already exists/);

  const prod = run("export-firestore.mjs", ["--project", "baseball-coach-997ab", "--out", "p.json"], {
    FIRESTORE_EMULATOR_HOST: "",
  });
  assert.equal(prod.code, 2);
  assert.match(prod.out, /--allow-production-read/);
});

test("restore is emulator-only and round-trips the export exactly", () => {
  const noEmu = run("restore-to-emulator.mjs", [...P, "--from-json", "export-1.json"], {
    FIRESTORE_EMULATOR_HOST: "",
  });
  assert.equal(noEmu.code, 2);
  assert.match(noEmu.out, /only targets the Firestore emulator/);

  const notEmpty = run("restore-to-emulator.mjs", [...P, "--from-json", "export-1.json"]);
  assert.match(notEmpty.out, /not empty/);

  const restored = run("restore-to-emulator.mjs", [...P, "--from-json", "export-1.json", "--replace"]);
  assert.equal(restored.code, 0, restored.out);

  const second = run("export-firestore.mjs", [...P, "--out", "export-2.json"]);
  assert.equal(second.code, 0, second.out);
  const a = read("export-1.json");
  const b = read("export-2.json");
  assert.deepEqual(b.raw, a.raw, "restored database is identical to the export");
  assert.deepEqual(b.seasons, a.seasons);
});

test("inventory and audit run from the export without touching Firestore", () => {
  const inv = run("season-inventory.mjs", ["--from-json", "export-1.json"]);
  assert.equal(inv.code, 0, inv.out);
  assert.match(inv.out, /ghost-2025.*MISSING/);
  assert.match(inv.out, /currentSeasonId: tigers-fall-2026/);

  const aud = run("identity-audit.mjs", ["--from-json", "export-1.json", "--out-dir", "audit"], {
    FIRESTORE_EMULATOR_HOST: "",
  });
  assert.equal(aud.code, 0, aud.out);
  const approvals = read("audit/identity-approvals.json");
  assert.ok(approvals.approvals.length >= 4);
  assert.ok(approvals.approvals.every((x) => x.decision === "pending"));
});
