// Tallies migration tool (Checkpoint D1) end to end on the emulator: the
// real CLI (inspect → plan → apply → verify → rollback) on the
// representative legacy dataset, then the migrated data under the TARGET
// rules with real anonymous, owner, other-coach, and stranger identities.
// Never touches a real project; production execution is refused.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";

import { PROJECT_ID, admin, clearFirestore, clientDb, closeClients, expectDenied } from "./support.mjs";
import { fromJson, loadSnapshot, toJson } from "../../tools/identity/firestore.mjs";
import { LEDGER_PATH, canonical, stateFromRaw } from "../../tools/tallies-migration/model.mjs";
import { FALCONS, FALCONS_DRAFT, FALL, OWNER, SPRING, legacyState, seedState } from "../support/talliesMigrationFixture.mjs";
import { listScopedSeasons, readScopedTeam } from "../../src/lib/teamData.ts";
import { setSeasonPublished } from "../../src/lib/teamPublication.ts";
import { saveCurrentLineup } from "../../src/lib/lineupStore.ts";
import { LEGACY_TIGERS_BRANDING } from "../../src/lib/branding.ts";

const TOOL = path.resolve("tools", "tallies-migrate.mjs");
const LOADER = pathToFileURL(path.resolve("tests", "support", "register-alias.mjs")).href;
const TARGET = fs.readFileSync("firestore.target.rules", "utf8");
const REPO = fs.readFileSync("firestore.rules", "utf8");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tallies-d1-"));
const P = ["--project", PROJECT_ID];

after(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await closeClients();
});

function run(args, env = {}) {
  const res = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", LOADER, TOOL, ...args], {
    cwd: dir,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}
let n = 0;
const file = (name) => path.join(dir, `${++n}-${name}`);
function exportDb() {
  const out = file("backup.json");
  const res = spawnSync(process.execPath, [path.resolve("tools", "export-firestore.mjs"), ...P, "--out", out], { cwd: dir, encoding: "utf8" });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  return out;
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
async function liveState() {
  return stateFromRaw(toJson(await loadSnapshot(admin)).raw);
}
const withoutLedger = (state) => [...state].filter(([p]) => !p.startsWith("migrationRuns/")).sort(([a], [b]) => a.localeCompare(b));
async function fresh(state = legacyState()) {
  await clearFirestore();
  await seedState(admin, state, fromJson);
}
async function planFile(extra = []) {
  const out = file("plan.json");
  const r = run(["plan", ...P, "--owner-uid", OWNER, "--out", out, ...extra]);
  return { code: r.code, out: r.out, file: out, plan: fs.existsSync(out) ? readJson(out) : null };
}
async function loadRules(content) {
  const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}:securityRules`, {
    method: "PUT",
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }),
  });
  if (!res.ok) throw new Error(`rules load failed: ${res.status}`);
}
async function updateTimes() {
  const refs = withoutLedger(await liveState()).map(([p]) => admin.doc(p));
  const snaps = await admin.getAll(...refs);
  return Object.fromEntries(snaps.map((s) => [s.ref.path, s.updateTime.toMillis()]));
}

let backup;
let migratedPlan;

before(async () => {
  await loadRules(REPO);
});

test("inspect → plan → apply → verify: the Tigers migrate intact, the Falcons draft stays private", async () => {
  await fresh();
  backup = exportDb();
  const inv = file("inventory.json");
  const ri = run(["inspect", ...P, "--out", inv]);
  assert.equal(ri.code, 0, ri.out);
  assert.doesNotMatch(ri.out, /Alex Rivera|Casey Morgan/, "console prints no names");
  const inventory = readJson(inv);
  assert.equal(inventory.seasons.length, 3);
  assert.equal(inventory.legacyCurrentSeason, FALL);

  const { code, out, file: planPath, plan } = await planFile();
  assert.equal(code, 0, out);
  assert.deepEqual(plan.blockers, []);
  migratedPlan = plan;
  assert.equal((await admin.doc(LEDGER_PATH).get()).exists, false, "planning writes nothing");

  const ra = run(["apply", ...P, "--plan", planPath, "--backup", backup]);
  assert.equal(ra.code, 0, ra.out);
  assert.match(ra.out, /Verification PASSED/);
  assert.doesNotMatch(ra.out, /Alex Rivera|Casey Morgan/);

  const report = file("verify.json");
  const rv = run(["verify", "--source", backup, ...P, "--out", report]);
  assert.equal(rv.code, 0, rv.out);
  assert.ok(readJson(report).ok);

  const src = readJson(backup);
  const T = plan.legacyTeamId;
  const team = (await admin.doc(`teams/${T}`).get()).data();
  assert.equal(team.teamName, "Tigers");
  assert.deepEqual(team.palettes, LEGACY_TIGERS_BRANDING.palettes, "orange Tigers branding");
  assert.deepEqual(team.logo, { kind: "bundled", id: "tigers" });
  assert.equal(team.ownerUid, OWNER);
  assert.equal(team.currentSeasonId, FALL);
  const spring = (await admin.doc(`seasons/${SPRING}`).get()).data();
  assert.equal(spring.status, "finalized");
  assert.equal(spring.finalizedAt.toDate().toISOString(), src.raw.seasons.find((s) => s.id === SPRING).data.finalizedAt.__timestamp);
  assert.equal(spring.published, true);
  assert.equal(spring.teamId, T);
  const draft = (await admin.doc(`seasons/${FALCONS_DRAFT}`).get()).data();
  assert.equal(draft.status, "draft");
  assert.equal(draft.published, false);
  assert.deepEqual((await admin.doc("app/config").get()).data().currentSeasonId, FALL, "legacy setting untouched");
  const ledger = (await admin.doc(LEDGER_PATH).get()).data();
  assert.equal(ledger.state, "complete");
  assert.equal(ledger.counts.conflict, 0);
});

test("re-running is idempotent: an empty plan, and no document is rewritten", async () => {
  const times = await updateTimes();
  const { code, out, file: planPath, plan } = await planFile();
  assert.equal(code, 0, out);
  assert.equal(plan.ops.length, 0);
  assert.equal(plan.targetDigest, migratedPlan.targetDigest);
  const ra = run(["apply", ...P, "--plan", planPath, "--backup", backup]);
  assert.equal(ra.code, 0, ra.out);
  assert.match(ra.out, /"created":0,"updated":0,"deleted":0/);
  // The original plan re-applied: every op is "unchanged".
  const rb = run(["apply", ...P, "--plan", migratedPlanFile(), "--backup", backup]);
  assert.equal(rb.code, 0, rb.out);
  assert.match(rb.out, /"created":0,"updated":0,"deleted":0,"unchanged":\d+/);
  assert.deepEqual(await updateTimes(), times, "no document rewritten");
});
function migratedPlanFile() {
  const f = file("plan-original.json");
  fs.writeFileSync(f, JSON.stringify(migratedPlan));
  return f;
}

test("target rules: anonymous, owner, another coach, and a stranger see exactly what they should", async () => {
  const T = migratedPlan.legacyTeamId;
  const batch = admin.batch();
  batch.set(admin.doc("coaches/coach-other"), { status: "active", workspaceId: "ws-other", inviteId: "inv-o" });
  batch.set(admin.doc("coachWorkspaces/ws-other"), { ownerUid: "coach-other", status: "active" });
  await batch.commit();
  await loadRules(TARGET);
  try {
    const anon = clientDb(null);
    const owner = clientDb(OWNER);
    const other = clientDb("coach-other");
    const stranger = clientDb("not-a-coach");
    const alexDraft = migratedPlan.idMap.find((r) => r.from.startsWith("a1a1"))?.to;

    for (const db of [anon, stranger, other]) {
      // Parents' route: public team → published seasons → records.
      const pt = (await getDoc(doc(db, "publicTeams", T))).data();
      assert.equal(pt.currentSeasonId, FALL);
      assert.equal(pt.teamName, "Tigers");
      const pub = await getDocs(query(collection(db, "seasons"), where("teamId", "==", T), where("published", "==", true)));
      assert.deepEqual(pub.docs.map((d) => d.id).sort(), [SPRING, FALL]);
      const alex = (await getDoc(doc(db, "seasons", FALL, "players", "21-alex-rivera"))).data();
      assert.ok(!("shirtSize" in alex) && !("careerPlayerId" in alex), "no private fields");
      assert.deepEqual(alex.careerLinks, [{ seasonId: SPRING, seasonPlayerId: "p01" }]);
      assert.ok((await getDocs(collection(db, "seasons", SPRING, "games"))).size > 0);
      assert.ok((await getDoc(doc(db, "seasons", FALL, "lineups", "current"))).exists());
      assert.equal((await getDoc(doc(db, "publicTeams", FALCONS))).data().currentSeasonId, null);
      // Private and unpublished: denied, however the path is reached.
      await expectDenied(getDoc(doc(db, "seasons", FALL, "players", "21-alex-rivera", "private", "profile")));
      await expectDenied(getDoc(doc(db, "seasons", SPRING, "private", "audit")));
      await expectDenied(getDoc(doc(db, "seasons", FALCONS_DRAFT)));
      await expectDenied(getDoc(doc(db, "seasons", FALCONS_DRAFT, "players", alexDraft)));
      await expectDenied(getDocs(collection(db, "seasons", FALCONS_DRAFT, "players")));
      await expectDenied(getDoc(doc(db, "teams", T)));
      await expectDenied(getDoc(doc(db, "teams", FALCONS)));
      await expectDenied(getDoc(doc(db, "migrationRuns", "tallies-d1")));
      await expectDenied(updateDoc(doc(db, "seasons", FALL), { league: "x" }));
    }

    // The owner, in the Tallies Admin's own data layer.
    const team = await readScopedTeam(owner, T);
    assert.equal(team.teamName, "Tigers");
    const scope = { uid: OWNER, workspaceId: team.workspaceId, team, seasonIds: null, refresh() {} };
    const seasons = await listScopedSeasons(owner, scope);
    assert.deepEqual(seasons.map((s) => s.seasonId).sort(), [SPRING, FALL], "only the Tigers' seasons");
    assert.equal((await getDoc(doc(owner, "seasons", FALL, "players", "21-alex-rivera", "private", "profile"))).data().shirtSize !== undefined, true);
    assert.equal((await getDoc(doc(owner, "seasons", FALCONS_DRAFT, "players", alexDraft, "private", "profile"))).data().careerPlayerId.startsWith("a1a1"), true);
    // Ownership is immutable; finalized history is frozen; teams stay apart.
    await expectDenied(updateDoc(doc(owner, "seasons", FALL), { ownerUid: "coach-other" }));
    await expectDenied(updateDoc(doc(owner, "seasons", FALL), { teamId: FALCONS }));
    await expectDenied(saveCurrentLineup(owner, { seasonId: SPRING, title: "x", inningCount: 3, rows: [], createdAtISO: "" }));
    await expectDenied(updateDoc(doc(owner, "teams", FALCONS), { currentSeasonId: FALL }));
    await expectDenied(updateDoc(doc(owner, "teams", T), { currentSeasonId: FALCONS_DRAFT }));
    await saveCurrentLineup(owner, { seasonId: FALL, title: "Next game", inningCount: 6, rows: [], createdAtISO: "" });
    // Unpublish/publish keeps career links consistent on migrated data.
    await setSeasonPublished({ db: owner, uid: OWNER, teamId: T, seasonId: SPRING, published: false });
    assert.equal((await getDoc(doc(anon, "seasons", FALL, "players", "21-alex-rivera"))).data().careerLinks, undefined);
    await expectDenied(getDoc(doc(anon, "seasons", SPRING)));
    await setSeasonPublished({ db: owner, uid: OWNER, teamId: T, seasonId: SPRING, published: true });
    assert.deepEqual((await getDoc(doc(anon, "seasons", FALL, "players", "21-alex-rivera"))).data().careerLinks, [{ seasonId: SPRING, seasonPlayerId: "p01" }]);

    // Another coach owns nothing here.
    assert.equal(await readScopedTeam(other, T), null, "Team not found for another coach");
    await expectDenied(getDoc(doc(other, "seasons", FALL, "players", "21-alex-rivera", "private", "profile")));
    await expectDenied(updateDoc(doc(other, "seasons", FALL), { published: false }));
    await expectDenied(updateDoc(doc(other, "publicTeams", T), { teamName: "Hijacked" }));
  } finally {
    await loadRules(REPO);
  }
});

test("an interrupted apply resumes to the same verified end state", async () => {
  await fresh();
  const b = exportDb();
  const { file: out, plan } = await planFile();
  const r1 = run(["apply", ...P, "--plan", out, "--backup", b, "--simulate-interruption-after", "2"]);
  assert.equal(r1.code, 6, r1.out);
  assert.equal((await admin.doc(LEDGER_PATH).get()).data().state, "applying");
  const rv = run(["verify", "--source", b, ...P, "--out", file("verify.json")]);
  assert.equal(rv.code, 4, "a half-applied migration does not verify");
  const re = await planFile();
  assert.equal(re.code, 0, re.out);
  assert.ok(re.plan.ops.length > 0 && re.plan.ops.length < plan.ops.length, "only the remainder is planned");
  assert.equal(re.plan.targetDigest, plan.targetDigest, "same end state");
  const r2 = run(["apply", ...P, "--plan", re.file, "--backup", b]);
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /Verification PASSED/);
  assert.equal((await admin.doc(LEDGER_PATH).get()).data().state, "complete");
});

test("rollback restores the exact pre-migration database (after a full and an interrupted apply)", async () => {
  await fresh();
  const b = exportDb();
  const original = withoutLedger(stateFromRaw(readJson(b).raw));
  const { file: out } = await planFile();
  assert.equal(run(["apply", ...P, "--plan", out, "--backup", b]).code, 0);
  const sha = fs.readFileSync(`${b}.sha256`, "utf8").slice(0, 8);
  const rbFile = fs.readdirSync(dir).filter((f) => f.endsWith(`-${sha}-rollback.json`)).map((f) => path.join(dir, f))[0];
  assert.ok(rbFile, "rollback file written next to the backup before applying");
  const r = run(["rollback", ...P, "--rollback", rbFile]);
  assert.equal(r.code, 0, r.out);
  assert.equal(canonical(withoutLedger(await liveState())), canonical(original), "byte-identical to the backup");
  assert.equal((await admin.doc(LEDGER_PATH).get()).data().state, "rolled-back");

  // Interrupted, then rolled back.
  assert.equal(run(["apply", ...P, "--plan", out, "--backup", b, "--simulate-interruption-after", "3"]).code, 6);
  assert.equal(run(["rollback", ...P, "--rollback", rbFile]).code, 0);
  assert.equal(canonical(withoutLedger(await liveState())), canonical(original));
  // And it can be applied again afterwards.
  const again = run(["apply", ...P, "--plan", out, "--backup", b]);
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /Verification PASSED/);
});

test("conflicts and source changes are refused; nothing is overwritten", async () => {
  await fresh();
  const b = exportDb();
  const { file: out } = await planFile();
  // The coach records something after the plan was reviewed.
  const line = (await admin.collectionGroup("lines").limit(1).get()).docs[0];
  const delta = line.data().delta;
  await line.ref.update({ "delta.hits": (delta.hits ?? 0) + 1 });
  const r = run(["apply", ...P, "--plan", out, "--backup", b]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /changed since this plan/);
  assert.equal((await admin.doc(LEDGER_PATH).get()).exists, false, "nothing written");
  assert.equal((await admin.collection("publicTeams").get()).size, 0);
  await line.ref.update({ delta });

  // A divergent destination document already exists.
  await admin.doc(`publicTeams/${FALCONS}`).set({ teamName: "Hawks" });
  const p2 = await planFile();
  assert.equal(p2.code, 3, p2.out);
  assert.match(p2.out, /conflict-public-team/);
  const r2 = run(["apply", ...P, "--plan", out, "--backup", b]);
  assert.notEqual(r2.code, 0);
  assert.deepEqual((await admin.doc(`publicTeams/${FALCONS}`).get()).data(), { teamName: "Hawks" }, "never overwritten");
  await admin.doc(`publicTeams/${FALCONS}`).delete();

  // A private record holding a different value.
  await admin.doc(`seasons/${FALL}/players/21-alex-rivera/private/profile`).set({ shirtSize: "AXL" });
  const p3 = await planFile();
  assert.equal(p3.code, 3);
  assert.match(p3.out, /conflict-private-profile/);
});

test("invalid ownership and broken references block the plan", async () => {
  await fresh();
  const r1 = run(["plan", ...P, "--owner-uid", "coach-other", "--out", file("plan.json")]);
  assert.equal(r1.code, 3);
  assert.match(r1.out, /owner-not-admin/);
  assert.doesNotMatch(r1.out, new RegExp(OWNER), "uids are redacted on the console");
  const r0 = run(["plan", ...P, "--out", file("plan.json")]);
  assert.equal(r0.code, 3);
  assert.match(r0.out, /owner-missing/);
  await admin.doc(`coaches/${OWNER}`).delete();
  const r2 = await planFile();
  assert.equal(r2.code, 3);
  assert.match(r2.out, /owner-not-bound/);
  await fresh();
  await admin.doc(`seasons/${FALCONS_DRAFT}`).update({ teamId: "deleted-team", "branding.teamId": "deleted-team" });
  const r3 = await planFile();
  assert.equal(r3.code, 3);
  assert.match(r3.out, /broken-team-reference/);
});

test("verification fails on intentional corruption of the live database", async () => {
  await fresh();
  const b = exportDb();
  const { file: out } = await planFile();
  assert.equal(run(["apply", ...P, "--plan", out, "--backup", b]).code, 0);
  const verify = () => {
    const f = file("verify.json");
    const r = run(["verify", "--source", b, ...P, "--out", f]);
    return { code: r.code, failed: readJson(f).checks.filter((c) => !c.ok).map((c) => c.id) };
  };
  assert.equal(verify().code, 0);
  const ref = admin.doc(`seasons/${FALL}/players/05-nico-vance`);
  const orig = (await ref.get()).data();
  await ref.update({ "stats.hits": 999 });
  assert.deepEqual(verify(), { code: 4, failed: ["rosters", "stats"] });
  await ref.set(orig);
  await ref.update({ shirtSize: "YM" });
  const v2 = verify();
  assert.equal(v2.code, 4);
  assert.ok(v2.failed.includes("privacy"));
  await ref.set(orig);
  const lineup = admin.doc(`seasons/${SPRING}/lineups/current`);
  const l = (await lineup.get()).data();
  await lineup.update({ rows: l.rows.slice(1) });
  assert.deepEqual(verify(), { code: 4, failed: ["lineups"] });
  await lineup.set(l);
  assert.equal(verify().code, 0);
});

test("production execution is refused before any connection", async () => {
  await fresh();
  const b = exportDb();
  const { file: out } = await planFile();
  const before = canonical(withoutLedger(await liveState()));
  const apply = (extra = [], env = {}, project = PROJECT_ID) => run(["apply", "--project", project, "--plan", out, "--backup", b, ...extra], env);
  const cases = [
    [apply([], {}, "baseball-coach-997ab"), /not a demo- project|backup is an export of/],
    [apply([], { FIRESTORE_EMULATOR_HOST: "" }), /FIRESTORE_EMULATOR_HOST is not set/],
    [apply([], { FIRESTORE_EMULATOR_HOST: "10.1.2.3:8085" }), /loopback/],
    [apply([], { FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" }), /loopback/],
    [apply(["--allow-production"]), /Unknown option "--allow-production"/],
    [apply([], { GOOGLE_APPLICATION_CREDENTIALS: path.join(dir, "none.json") }), /GOOGLE_APPLICATION_CREDENTIALS/],
    [apply([], { GCLOUD_PROJECT: "baseball-coach-997ab" }), /conflicts/],
    [apply([], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:65530" }), /No Firestore emulator answers/],
    [run(["rollback", "--project", "baseball-coach-997ab", "--rollback", out]), /not a demo- project/],
    [run(["inspect", "--project", "baseball-coach-997ab", "--out", file("inv.json")]), /not a demo- project/],
    [run(["inspect", ...P, "--out", file("inv.json")], { FIRESTORE_EMULATOR_HOST: "" }), /not set/],
  ];
  for (const [r, re] of cases) {
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, re);
  }
  assert.equal((await admin.doc(LEDGER_PATH).get()).exists, false);
  assert.equal(canonical(withoutLedger(await liveState())), before, "nothing changed");
});

test("outputs holding child data are refused inside the repository", async () => {
  const r = run(["inspect", ...P, "--out", path.resolve("inventory-in-repo.json")]);
  assert.equal(r.code, 1);
  assert.match(r.out, /outside the repository/);
  assert.equal(fs.existsSync(path.resolve("inventory-in-repo.json")), false);
});
