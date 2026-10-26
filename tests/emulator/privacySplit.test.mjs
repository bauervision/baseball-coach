// Public/private split migration (tools/privacy-split-migrate.mjs) on the
// production-shaped fixture: plan → guarded apply → verify → idempotent
// re-run → exact rollback. Never touches a real project.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { admin, clearFirestore, clientDb, closeClients, PROJECT_ID, seed } from "./support.mjs";
import { addPlayersToRoster, createSeasonOrResume, finalizeSeason } from "../../src/app/(protected)/admin/_parts/adminActions.ts";
import { LEGACY_TIGERS_BRANDING } from "../../src/lib/branding.ts";
import { loadCareerSummary } from "../../src/lib/playerCareerStats.ts";
import { PLAYER_PRIVATE, SEASON_PRIVATE } from "../../tools/privacy-split-migrate.mjs";
import { statsDigest } from "../../tools/identity/audit.mjs";
import { loadSnapshot, toJson } from "../../tools/identity/firestore.mjs";
import { COACH_UID } from "../support/fixtures.mjs";
import { PS_IDS, productionShapedSnapshot } from "../support/productionShapedFixture.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-split-"));
after(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await closeClients();
});

function run(args, env = {}) {
  const res = spawnSync(process.execPath, [path.resolve("tools", "privacy-split-migrate.mjs"), ...args], {
    cwd: dir,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}
const runExport = (out) =>
  spawnSync(process.execPath, [path.resolve("tools", "export-firestore.mjs"), "--project", PROJECT_ID, "--out", out], { cwd: dir, encoding: "utf8" });

const P = ["--project", PROJECT_ID];
const snapshot = async () => {
  const s = toJson(await loadSnapshot(admin));
  delete s.exportedAt;
  return s;
};
const allPlayers = async () => {
  const out = [];
  for (const s of (await admin.collection("seasons").get()).docs) {
    for (const p of (await s.ref.collection("players").get()).docs) out.push({ seasonId: s.id, id: p.id, data: p.data(), ref: p.ref });
  }
  return out;
};

const DRAFT = "tigers-spring-2027";
let original;
let careerBefore;
before(async () => {
  await clearFirestore();
  await seed(productionShapedSnapshot({ migrated: true }), [COACH_UID]);
  // A finalized season, so lifecycle audit fields (coach UIDs) exist.
  const coach = clientDb(COACH_UID);
  await finalizeSeason({ db: coach, uid: COACH_UID, seasonId: "tigers-2026" });
  // An unpublished draft that imported a returning player (as in production).
  const team = { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "tigers-0001" };
  await admin.doc("teams/tigers-0001").set({ ...team, createdAt: new Date(), updatedAt: new Date() });
  await createSeasonOrResume({ db: coach, uid: COACH_UID, team, seasonId: DRAFT, seasonLabel: "Spring 2027", scheduledGames: 12, existingSeasonIds: [] });
  const alex = (await admin.doc("seasons/tigers-fall-2026/players/21-alex-rivera").get()).data();
  await addPlayersToRoster({ db: coach, seasonId: DRAFT, imports: [{ careerPlayerId: alex.careerPlayerId, name: alex.name, number: "21", primaryPos: "", shirtSize: "", linkedFrom: [{ seasonId: "tigers-fall-2026", seasonPlayerId: "21-alex-rivera" }, { seasonId: "tigers-2026", seasonPlayerId: "p01" }] }], newPlayers: [] });
  original = await snapshot();
  // Career seasons per entry as the current app computes them (public reads).
  careerBefore = new Map();
  for (const p of await allPlayers()) {
    if (!p.data.careerPlayerId) continue;
    const career = await loadCareerSummary({ db: clientDb(null), seasonId: p.seasonId, player: { id: p.id, ...p.data }, currentSeason: { teamName: "Tigers", seasonLabel: "x" } });
    careerBefore.set(`${p.seasonId}/${p.id}`, career.history.map((h) => h.seasonId).sort());
  }
});

test("refuses a real project without the production flag", () => {
  const r = run(["--project", "baseball-coach-997ab"], { FIRESTORE_EMULATOR_HOST: "" });
  assert.equal(r.code, 2);
  assert.match(r.out, /Refusing to touch a real project/);
});

test("plan, guarded apply, verify, idempotent re-run, rollback", async () => {
  const dry = run(P);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /Planned updates: 26 \(24 roster entries, 2 seasons\)/);
  assert.deepEqual(await snapshot(), original, "dry run writes nothing");

  const noBackup = run([...P, "--apply"]);
  assert.equal(noBackup.code, 2);
  assert.match(noBackup.out, /requires --backup/);
  assert.equal(runExport("backup.json").status, 0);

  const applied = run([...P, "--backup", "backup.json", "--apply"]);
  assert.equal(applied.code, 0, applied.out);
  assert.match(applied.out, /Verified: private fields moved exactly/);

  // No private field remains in any publicly readable document.
  for (const p of await allPlayers()) {
    for (const k of PLAYER_PRIVATE) assert.ok(!(k in p.data), `${p.seasonId}/${p.id}.${k} still public`);
    const prof = (await p.ref.collection("private").doc("profile").get()).data();
    const orig = original.seasons.find((s) => s.seasonId === p.seasonId).players.find((x) => x.id === p.id).data;
    for (const k of PLAYER_PRIVATE) if (k in orig) assert.deepEqual(prof[k], orig[k], `${p.id}.${k} preserved privately`);
  }
  for (const s of (await admin.collection("seasons").get()).docs) {
    for (const k of SEASON_PRIVATE) assert.ok(!(k in s.data()), `${s.id}.${k} still public`);
  }
  const audit = (await admin.doc("seasons/tigers-2026/private/audit").get()).data();
  assert.equal(audit.finalizedByUid, COACH_UID);
  assert.equal(audit.lifecycleHistory.length, 1);
  assert.equal((await admin.doc("seasons/tigers-2026").get()).data().status, "finalized", "status stays public");

  // Career links cover exactly the seasons the app's career logic finds.
  for (const p of await allPlayers()) {
    for (const l of p.data.careerLinks ?? []) assert.notEqual(l.seasonId, DRAFT, `${p.seasonId}/${p.id} links to an unpublished draft`);
    const want = careerBefore.get(`${p.seasonId}/${p.id}`);
    if (!want) continue;
    const got = [p.seasonId, ...(p.data.careerLinks ?? []).map((l) => l.seasonId)].sort();
    assert.deepEqual(got, want.filter((s) => s !== DRAFT || s === p.seasonId), `${p.seasonId}/${p.id} career seasons (app view minus drafts)`);
  }
  // The draft's own entry may link to its published history (it is not public itself).
  assert.deepEqual((await admin.doc(`seasons/${DRAFT}/players/${PS_IDS.alex}`).get()).data().careerLinks.map((l) => l.seasonId).sort(), ["tigers-2026", "tigers-fall-2026"]);
  assert.deepEqual((await admin.doc("seasons/tigers-fall-2026/players/500-blake-turner").get()).data().careerLinks, [{ seasonId: "tigers-2026", seasonPlayerId: "p02" }]);

  // Stats, games, lines, lineups, awards, layouts unchanged.
  const now = await snapshot();
  assert.equal(statsDigest(now), statsDigest(original));
  for (const s of original.seasons) {
    const n = now.seasons.find((x) => x.seasonId === s.seasonId);
    assert.deepEqual(n.games, s.games, `${s.seasonId} games and lines`);
    assert.deepEqual(n.lineups, s.lineups, `${s.seasonId} lineups`);
    for (const k of ["finalAwards", "recognitionLayouts", "record", "record.wins", "branding"]) assert.deepEqual(n.data[k], s.data[k], `${s.seasonId}.${k}`);
  }

  const again = run(P);
  assert.match(again.out, /Planned updates: 0/);

  const rollbackFile = fs.readdirSync(dir).find((f) => /^privacy-split-.*-rollback\.json$/.test(f));
  const rb = run([...P, "--rollback", rollbackFile]);
  assert.equal(rb.code, 0, rb.out);
  assert.deepEqual(await snapshot(), original, "rollback restores the original dataset exactly");
});

test("conflicting private values stop the plan before any write", async () => {
  await admin.doc("seasons/tigers-fall-2026/players/21-alex-rivera/private/profile").set({ shirtSize: "AXL" });
  const r = run(P);
  assert.equal(r.code, 3);
  assert.match(r.out, /already holds a different value/);
  await admin.doc("seasons/tigers-fall-2026/players/21-alex-rivera/private/profile").delete();
});
