// TARGET multi-coach ruleset (firestore.target.rules) on the emulator:
// anonymous parents, unapproved users, two independent coaches, publication,
// team current season, private fields, ownership immutability, and the old
// app's write patterns after the public/private split. Not deployed.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";

import { PROJECT_ID, admin, clearFirestore, clientDb, closeClients, expectDenied, seed } from "./support.mjs";
import { LEGACY_TIGERS_BRANDING } from "../../src/lib/branding.ts";
import { applyOps, planSplit, readState, PLAYER_PRIVATE } from "../../tools/privacy-split-migrate.mjs";
import { productionShapedSnapshot } from "../support/productionShapedFixture.mjs";

const TARGET = fs.readFileSync("firestore.target.rules", "utf8");
const REPO = fs.readFileSync("firestore.rules", "utf8");
const A = "coach-a";
const B = "coach-b";
const SPRING = "tigers-2026";
const FALL = "tigers-fall-2026";
const A_DRAFT = "tigers-spring-2027";
const B_PUB = "hawks-fall-2026";
const B_DRAFT = "hawks-spring-2027";
const PUBLIC_PLAYER_FIELDS = new Set(["id", "name", "number", "bats", "throws", "primaryPos", "returningPlayer", "leaderboardHidden", "stats", "careerLinks", "createdAt", "updatedAt"]);

async function loadRules(content) {
  const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}:securityRules`, {
    method: "PUT",
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }),
  });
  if (!res.ok) throw new Error(`rules load failed: ${res.status}`);
}

const team = (teamId, ownerUid, workspaceId, extra = {}) => ({ ...structuredClone(LEGACY_TIGERS_BRANDING), teamId, ownerUid, workspaceId, createdAt: new Date(), updatedAt: new Date(), ...extra });

let anon, stranger, a, b;
before(async () => {
  await loadRules(TARGET);
  anon = clientDb(null);
  stranger = clientDb("signed-in-not-approved");
  a = clientDb(A);
  b = clientDb(B);
});
after(async () => {
  await loadRules(REPO);
  await closeClients();
});

beforeEach(async () => {
  await clearFirestore();
  // Coach A: the original coach after migration (production-shaped Tigers).
  await seed(productionShapedSnapshot({ migrated: true }), [A]);
  const batch = admin.batch();
  batch.set(admin.doc(`coaches/${A}`), { status: "active", workspaceId: "ws-a", inviteId: "inv-a" });
  batch.set(admin.doc(`coaches/${B}`), { status: "active", workspaceId: "ws-b", inviteId: "inv-b" });
  batch.set(admin.doc("coachWorkspaces/ws-a"), { ownerUid: A, status: "active" });
  batch.set(admin.doc("coachWorkspaces/ws-b"), { ownerUid: B, status: "active" });
  batch.set(admin.doc("teams/tigers-0001"), team("tigers-0001", A, "ws-a", { currentSeasonId: FALL }));
  batch.set(admin.doc("teams/hawks-0001"), team("hawks-0001", B, "ws-b", { teamName: "Hawks" }));
  for (const id of [SPRING, FALL]) batch.set(admin.doc(`seasons/${id}`), { teamId: "tigers-0001", ownerUid: A, published: true }, { merge: true });
  batch.set(admin.doc(`seasons/${A_DRAFT}`), { teamId: "tigers-0001", ownerUid: A, teamName: "Tigers", seasonLabel: "Spring 2027", status: "draft", published: false, gamesPlayed: 0, record: { wins: 0, losses: 0, ties: 0 } });
  batch.set(admin.doc(`seasons/${A_DRAFT}/players/x1`), { name: "Draft Kid", number: 3, stats: {} });
  batch.set(admin.doc(`seasons/${B_PUB}`), { teamId: "hawks-0001", ownerUid: B, teamName: "Hawks", seasonLabel: "Fall 2026", status: "active", published: true });
  batch.set(admin.doc(`seasons/${B_PUB}/players/h1`), { name: "Hawk One", number: 1, stats: {} });
  batch.set(admin.doc(`seasons/${B_PUB}/players/h1/private/profile`), { shirtSize: "YM" });
  batch.set(admin.doc(`seasons/${B_DRAFT}`), { teamId: "hawks-0001", ownerUid: B, teamName: "Hawks", seasonLabel: "Spring 2027", status: "draft", published: false });
  batch.set(admin.doc("publicTeams/tigers-0001"), { teamName: "Tigers", shortName: LEGACY_TIGERS_BRANDING.shortName, sport: "baseball", division: LEGACY_TIGERS_BRANDING.division, logo: LEGACY_TIGERS_BRANDING.logo, palettes: LEGACY_TIGERS_BRANDING.palettes, awardCollection: "original", currentSeasonId: FALL });
  await batch.commit();
  // The public/private split, exactly as the migration tool applies it.
  const ops = planSplit(await readState(admin));
  await applyOps(admin, ops, "test-split");
});

const read = (d, path) => getDoc(doc(d, path));
const audit = (d, seasonId, action, byUid, before = []) =>
  [doc(d, "seasons", seasonId, "private", "audit"), { lifecycleHistory: [...before, { action, at: "t", byUid }] }];

test("anonymous parents read published seasons and public fields only", async () => {
  assert.ok((await read(anon, `seasons/${FALL}`)).exists());
  const players = await getDocs(collection(anon, "seasons", FALL, "players"));
  assert.equal(players.size, 11);
  for (const p of players.docs) {
    const extra = Object.keys(p.data()).filter((k) => !PUBLIC_PLAYER_FIELDS.has(k));
    assert.deepEqual(extra, [], `${p.id} exposes ${extra}`);
  }
  assert.ok((await getDocs(collection(anon, "seasons", SPRING, "games"))).size > 0, "games public");
  assert.ok((await read(anon, "publicTeams/tigers-0001")).exists());
  const pub = await getDocs(query(collection(anon, "seasons"), where("published", "==", true)));
  assert.deepEqual(pub.docs.map((d) => d.id).sort(), [B_PUB, SPRING, FALL].sort());

  for (const path of [`seasons/${A_DRAFT}`, `seasons/${A_DRAFT}/players/x1`, `seasons/${FALL}/players/21-alex-rivera/private/profile`,
    `seasons/${SPRING}/private/audit`, "teams/tigers-0001", `coaches/${A}`, "coachWorkspaces/ws-a", "coachInvites/inv-a",
    `playerIdentities/aaaaaaaa-0000-4000-8000-000000000000`, `coachProfiles/${A}/linkedPlayers/x`]) {
    await expectDenied(read(anon, path));
  }
  await expectDenied(getDocs(collection(anon, "seasons")));
  await expectDenied(getDocs(collection(anon, "seasons", A_DRAFT, "players")));
});

test("a signed-in but unapproved user gets nothing beyond public and cannot create", async () => {
  await expectDenied(read(stranger, `seasons/${A_DRAFT}`));
  await expectDenied(read(stranger, "teams/tigers-0001"));
  await expectDenied(getDocs(query(collection(stranger, "teams"), where("ownerUid", "==", "signed-in-not-approved"))));
  await expectDenied(setDoc(doc(stranger, "teams", "mine-0001"), team("mine-0001", "signed-in-not-approved", "ws-x")));
  await expectDenied(setDoc(doc(stranger, "coaches", "signed-in-not-approved"), { status: "active", workspaceId: "ws-x" }));
});

test("cross-coach: B cannot read or change A's private records, and vice versa", async () => {
  for (const [me, other, otherTeam, otherDraft, otherPub, otherPlayer] of [
    [b, A, "tigers-0001", A_DRAFT, FALL, "21-alex-rivera"],
    [a, B, "hawks-0001", B_DRAFT, B_PUB, "h1"],
  ]) {
    await expectDenied(read(me, `teams/${otherTeam}`));
    await expectDenied(read(me, `seasons/${otherDraft}`));
    await expectDenied(read(me, `seasons/${otherPub}/players/${otherPlayer}/private/profile`));
    await expectDenied(getDocs(query(collection(me, "teams"), where("ownerUid", "==", other))));
    await expectDenied(getDocs(query(collection(me, "seasons"), where("ownerUid", "==", other))));
    assert.ok((await read(me, `seasons/${otherPub}`)).exists(), "published pages stay public");
    await expectDenied(updateDoc(doc(me, "seasons", otherPub), { seasonLabel: "Hijacked" }));
    await expectDenied(setDoc(doc(me, "seasons", otherPub, "players", "intruder"), { name: "X", number: 1, stats: {} }));
    await expectDenied(setDoc(doc(me, "seasons", otherPub, "games", "g"), { date: "x" }));
    await expectDenied(updateDoc(doc(me, "teams", otherTeam), { teamName: "Mine" }));
    await expectDenied(setDoc(doc(me, "seasons", "claim-2027"), { teamId: otherTeam, ownerUid: me === a ? A : B, status: "draft", published: false }));
  }
  // Each coach sees exactly their own teams through a scoped query.
  assert.deepEqual((await getDocs(query(collection(b, "teams"), where("ownerUid", "==", B)))).docs.map((d) => d.id), ["hawks-0001"]);
  assert.deepEqual((await getDocs(query(collection(a, "seasons"), where("ownerUid", "==", A)))).docs.map((d) => d.id).sort(), [A_DRAFT, SPRING, FALL].sort());
});

test("ownership and identity fields are immutable; forged workspaces are rejected", async () => {
  await expectDenied(updateDoc(doc(b, "seasons", B_PUB), { ownerUid: A }));
  await expectDenied(updateDoc(doc(a, "seasons", FALL), { ownerUid: B }));
  await expectDenied(updateDoc(doc(a, "seasons", FALL), { teamId: "hawks-0001" }));
  await expectDenied(updateDoc(doc(a, "teams", "tigers-0001"), { workspaceId: "ws-b" }));
  await expectDenied(setDoc(doc(a, "teams", "new-0001"), team("new-0001", A, "ws-b")), "foreign workspace");
  await setDoc(doc(a, "teams", "new-0001"), team("new-0001", A, "ws-a"));
  await expectDenied(setDoc(doc(a, "seasons", "s-pub"), { teamId: "new-0001", ownerUid: A, status: "draft", published: true }), "born published");
});

test("private fields never return to public docs; the owner keeps them privately", async () => {
  const P = (...p) => doc(a, "seasons", FALL, "players", ...p);
  await expectDenied(updateDoc(P("21-alex-rivera"), { shirtSize: "YL" }));
  await expectDenied(setDoc(P("new"), { name: "N", number: 9, stats: {}, careerPlayerId: "x" }));
  await updateDoc(P("21-alex-rivera", "private", "profile"), { shirtSize: "YL" });
  assert.equal((await read(a, `seasons/${FALL}/players/21-alex-rivera/private/profile`)).data().shirtSize, "YL");
  await expectDenied(updateDoc(doc(a, "seasons", FALL), { coachUids: [A] }));
  await updateDoc(P("21-alex-rivera"), { number: 22 }); // ordinary public edit
});

test("publication and lifecycle: drafts stay private; transitions need an audit entry by the actor", async () => {
  const D = doc(a, "seasons", A_DRAFT);
  await expectDenied(updateDoc(D, { published: true }), "draft cannot be published");
  await expectDenied(updateDoc(D, { status: "active" }), "activation without audit");
  let bt = writeBatch(a);
  bt.update(D, { status: "active" });
  bt.set(...audit(a, A_DRAFT, "activated", B));
  await expectDenied(bt.commit(), "audit attributed to someone else");
  bt = writeBatch(a);
  bt.update(D, { status: "active" });
  bt.set(...audit(a, A_DRAFT, "activated", A));
  await bt.commit();
  await expectDenied(updateDoc(D, { published: true, seasonLabel: "x" }), "publication is its own change");
  await updateDoc(D, { published: true });
  assert.ok((await read(anon, `seasons/${A_DRAFT}`)).exists(), "published now");

  // Finalized seasons can still be unpublished/published, nothing else.
  const S = doc(a, "seasons", SPRING);
  const before = (await read(a, `seasons/${SPRING}/private/audit`)).data()?.lifecycleHistory ?? [];
  bt = writeBatch(a);
  bt.update(S, { status: "finalized" });
  bt.set(...audit(a, SPRING, "finalized", A, before), { merge: true });
  await bt.commit();
  await expectDenied(updateDoc(S, { seasonLabel: "Edited" }));
  await updateDoc(S, { published: false });
  await expectDenied(read(anon, `seasons/${SPRING}`));
  await updateDoc(S, { published: true });
  // Audit history is append-only.
  await expectDenied(setDoc(doc(a, "seasons", SPRING, "private", "audit"), { lifecycleHistory: [] }));
});

test("team current season: own, non-draft, non-finalized seasons of that team only", async () => {
  const T = doc(a, "teams", "tigers-0001");
  await updateDoc(T, { currentSeasonId: SPRING });
  await expectDenied(updateDoc(T, { currentSeasonId: A_DRAFT }), "draft");
  await expectDenied(updateDoc(T, { currentSeasonId: B_PUB }), "another coach's season");
  await expectDenied(updateDoc(T, { currentSeasonId: "missing" }));
  // Activation and team switch together.
  const bt = writeBatch(a);
  bt.update(doc(a, "seasons", A_DRAFT), { status: "active" });
  bt.set(...audit(a, A_DRAFT, "activated", A));
  bt.update(T, { currentSeasonId: A_DRAFT });
  await bt.commit();
  // Another team's current season is unaffected.
  assert.equal((await read(b, "teams/hawks-0001")).data().currentSeasonId, undefined);
});

test("old app (v1.3.0) patterns after the split: own legacy seasons ok, private fields refused", async () => {
  // switchSeason merge-writes labels + global config (legacy), stat entry, layouts.
  const bt = writeBatch(a);
  bt.set(doc(a, "seasons", SPRING), { teamName: "Tigers", seasonLabel: "Spring 2026", updatedAt: new Date() }, { merge: true });
  bt.set(doc(a, "app", "config"), { currentSeasonId: SPRING, updatedAt: new Date() }, { merge: true });
  await bt.commit();
  await setDoc(doc(a, "seasons", FALL, "games", "g-new"), { date: "2026-11-01", opponent: "X", result: "W" }, { merge: true });
  await setDoc(doc(a, "seasons", FALL, "players", "21-alex-rivera"), { stats: { hits: 1 } }, { merge: true });
  // savePlayerEdits / rebuildRoster write shirtSize / careerPlayerId into public docs: refused.
  await expectDenied(setDoc(doc(a, "seasons", FALL, "players", "21-alex-rivera"), { name: "Alex Rivera", number: "21", shirtSize: "YM" }, { merge: true }));
  // The old app's global config can never point at another coach's season.
  await expectDenied(setDoc(doc(a, "app", "config"), { currentSeasonId: B_PUB }, { merge: true }));
  await expectDenied(setDoc(doc(b, "app", "config"), { currentSeasonId: B_PUB }, { merge: true }), "not the legacy coach");
});

test("historical Tigers seasons stay readable with all stats after the split", async () => {
  for (const id of [SPRING, FALL]) {
    const ps = await getDocs(collection(anon, "seasons", id, "players"));
    const before = productionShapedSnapshot({ migrated: true }).seasons.find((s) => s.seasonId === id);
    for (const p of before.players) {
      const now = ps.docs.find((d) => d.id === p.id).data();
      assert.deepEqual(now.stats, p.data.stats, `${id}/${p.id} stats`);
      for (const k of PLAYER_PRIVATE) assert.ok(!(k in now));
    }
  }
});
