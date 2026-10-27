// Team routes, team-specific current season, and publication on the TARGET
// rules (firestore.target.rules, not deployed), driven through the app's own
// actions (src/lib/teamPublication.ts) as real client identities:
// anonymous parents, two independent coaches, and a coach with two teams.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";

import { PROJECT_ID, admin, clearFirestore, clientDb, closeClients, expectDenied, seed } from "./support.mjs";
import { LEGACY_TIGERS_BRANDING } from "../../src/lib/branding.ts";
import { applyOps, planSplit, readState } from "../../tools/privacy-split-migrate.mjs";
import { productionShapedSnapshot } from "../support/productionShapedFixture.mjs";
import { publicTeamProjection, readOwnedTeam, setSeasonPublished, setTeamCurrentSeason } from "../../src/lib/teamPublication.ts";
import { listPublishedTeamSeasons } from "../../src/lib/seasonStore.ts";
import { loadPublicCareer } from "../../src/lib/playerCareerStats.ts";

const TARGET = fs.readFileSync("firestore.target.rules", "utf8");
const REPO = fs.readFileSync("firestore.rules", "utf8");
const A = "coach-a";
const B = "coach-b";
const TIGERS = "tigers-0001";
const FALCONS = "falcons-0002";
const HAWKS = "hawks-0001";
const SPRING = "tigers-2026";
const FALL = "tigers-fall-2026";
const A_DRAFT = "tigers-spring-2027";
const F_ACTIVE = "falcons-fall-2026";
const F_DRAFT = "falcons-spring-2027";
const B_PUB = "hawks-fall-2026";
const ALEX_SPRING = "p01";
const ALEX_FALL = "21-alex-rivera";

async function loadRules(content) {
  const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}:securityRules`, {
    method: "PUT",
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }),
  });
  if (!res.ok) throw new Error(`rules load failed: ${res.status}`);
}

const team = (teamId, ownerUid, workspaceId, extra = {}) => ({
  ...structuredClone(LEGACY_TIGERS_BRANDING), teamId, ownerUid, workspaceId, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), ...extra,
});
const pub = (t, currentSeasonId) => ({ ...publicTeamProjection(t, currentSeasonId), updatedAt: new Date() });

let anon, a, b;
before(async () => {
  await loadRules(TARGET);
  anon = clientDb(null);
  a = clientDb(A);
  b = clientDb(B);
});
after(async () => {
  await loadRules(REPO);
  await closeClients();
});

beforeEach(async () => {
  await clearFirestore();
  await seed(productionShapedSnapshot({ migrated: true }), [A]);
  const tigers = team(TIGERS, A, "ws-a", { currentSeasonId: FALL });
  const falcons = team(FALCONS, A, "ws-a", { teamName: "Falcons", shortName: "FAL" });
  const hawks = team(HAWKS, B, "ws-b", { teamName: "Hawks", shortName: "HWK", currentSeasonId: B_PUB });
  const batch = admin.batch();
  batch.set(admin.doc(`coaches/${A}`), { status: "active", workspaceId: "ws-a", inviteId: "inv-a" });
  batch.set(admin.doc(`coaches/${B}`), { status: "active", workspaceId: "ws-b", inviteId: "inv-b" });
  batch.set(admin.doc("coachWorkspaces/ws-a"), { ownerUid: A, status: "active" });
  batch.set(admin.doc("coachWorkspaces/ws-b"), { ownerUid: B, status: "active" });
  batch.set(admin.doc(`teams/${TIGERS}`), tigers);
  batch.set(admin.doc(`teams/${FALCONS}`), falcons);
  batch.set(admin.doc(`teams/${HAWKS}`), hawks);
  // Spring 2026 is finalized (read-only); Fall 2026 is current and active.
  batch.set(admin.doc(`seasons/${SPRING}`), { teamId: TIGERS, ownerUid: A, published: true, status: "finalized" }, { merge: true });
  batch.set(admin.doc(`seasons/${FALL}`), { teamId: TIGERS, ownerUid: A, published: true, status: "active" }, { merge: true });
  batch.set(admin.doc(`seasons/${A_DRAFT}`), { teamId: TIGERS, ownerUid: A, teamName: "Tigers", seasonLabel: "Spring 2027", status: "draft", published: false, gamesPlayed: 0, record: { wins: 0, losses: 0, ties: 0 } });
  batch.set(admin.doc(`seasons/${F_ACTIVE}`), { teamId: FALCONS, ownerUid: A, teamName: "Falcons", seasonLabel: "Fall 2026", status: "active", published: false });
  batch.set(admin.doc(`seasons/${F_ACTIVE}/players/f1`), { name: "Falcon One", number: 7, stats: {} });
  batch.set(admin.doc(`seasons/${F_DRAFT}`), { teamId: FALCONS, ownerUid: A, teamName: "Falcons", seasonLabel: "Spring 2027", status: "draft", published: false });
  batch.set(admin.doc(`seasons/${B_PUB}`), { teamId: HAWKS, ownerUid: B, teamName: "Hawks", seasonLabel: "Fall 2026", status: "active", published: true });
  batch.set(admin.doc(`seasons/${B_PUB}/players/h1`), { name: "Hawk One", number: 1, stats: {} });
  batch.set(admin.doc(`publicTeams/${TIGERS}`), pub(tigers, FALL));
  batch.set(admin.doc(`publicTeams/${HAWKS}`), pub(hawks, B_PUB));
  await batch.commit();
  await applyOps(admin, planSplit(await readState(admin)), "test-split");
});

const read = (d, path) => getDoc(doc(d, path));
const publicCurrent = async (teamId) => (await read(anon, `publicTeams/${teamId}`)).data()?.currentSeasonId ?? null;
const links = async (seasonId, playerId) => (await admin.doc(`seasons/${seasonId}/players/${playerId}`).get()).data().careerLinks ?? [];

test("parents (anonymous) see a team's published seasons and its published current season only", async () => {
  assert.equal(await publicCurrent(TIGERS), FALL);
  const list = await listPublishedTeamSeasons(anon, TIGERS);
  assert.deepEqual(list.map((s) => s.seasonId).sort(), [SPRING, FALL].sort());
  await expectDenied(getDocs(query(collection(anon, "seasons"), where("teamId", "==", TIGERS))), "unfiltered team query (would include drafts)");
  await expectDenied(read(anon, `seasons/${A_DRAFT}`), "draft season");
  await expectDenied(read(anon, `seasons/${F_ACTIVE}`), "activated but unpublished season");
  await expectDenied(read(anon, `teams/${TIGERS}`), "private team doc");
  const projection = (await read(anon, `publicTeams/${TIGERS}`)).data();
  for (const k of ["ownerUid", "workspaceId", "teamId", "createdAt"]) assert.ok(!(k in projection), `publicTeams has no ${k}`);
  assert.equal((await read(anon, `publicTeams/${FALCONS}`)).exists(), false, "a team without a projection is not found");
});

test("each team has its own current season; changing one never changes another or app/config", async () => {
  const cfgBefore = (await admin.doc("app/config").get()).data();
  await setTeamCurrentSeason({ db: a, uid: A, teamId: FALCONS, seasonId: F_ACTIVE });
  assert.equal((await admin.doc(`teams/${FALCONS}`).get()).data().currentSeasonId, F_ACTIVE);
  assert.equal((await admin.doc(`teams/${TIGERS}`).get()).data().currentSeasonId, FALL, "Tigers unchanged");
  assert.equal(await publicCurrent(FALCONS), null, "unpublished current season stays hidden from parents");
  assert.equal(await publicCurrent(TIGERS), FALL);
  assert.deepEqual((await admin.doc("app/config").get()).data(), cfgBefore, "global config untouched");

  // Publishing the Falcons season makes it the Falcons' public current season.
  await setSeasonPublished({ db: a, uid: A, teamId: FALCONS, seasonId: F_ACTIVE, published: true });
  assert.equal(await publicCurrent(FALCONS), F_ACTIVE);
  assert.equal(await publicCurrent(TIGERS), FALL, "Tigers parent link still shows Fall 2026");
});

test("a draft becomes current only through activation (audited), and stays hidden until published", async () => {
  const r = await setTeamCurrentSeason({ db: a, uid: A, teamId: TIGERS, seasonId: A_DRAFT });
  assert.equal(r.activated, true);
  const s = (await admin.doc(`seasons/${A_DRAFT}`).get()).data();
  assert.equal(s.status, "active");
  assert.ok(!("lifecycleHistory" in s), "audit lives in private/audit, not the season doc");
  const audit = (await admin.doc(`seasons/${A_DRAFT}/private/audit`).get()).data().lifecycleHistory;
  assert.deepEqual(audit.map((e) => [e.action, e.byUid]), [["activated", A]]);
  assert.equal(await publicCurrent(TIGERS), null, "the new season is not revealed to parents");
  await expectDenied(read(anon, `seasons/${A_DRAFT}`), "activated, unpublished season");
  assert.equal((await admin.doc(`teams/${FALCONS}`).get()).data().currentSeasonId, undefined, "other team untouched");
});

test("invalid team current-season references are rejected by rules", async () => {
  const setCurrent = (d, teamId, seasonId) => updateDoc(doc(d, "teams", teamId), { currentSeasonId: seasonId, updatedAt: new Date() });
  await expectDenied(setCurrent(a, TIGERS, B_PUB), "another coach's season");
  await expectDenied(setCurrent(a, TIGERS, F_ACTIVE), "own season of another team");
  await expectDenied(setCurrent(a, TIGERS, "no-such-season"), "missing season");
  await expectDenied(setCurrent(a, TIGERS, A_DRAFT), "draft without activation");
  await expectDenied(setCurrent(a, TIGERS, SPRING), "finalized season (reopen first)");
  await assert.rejects(setTeamCurrentSeason({ db: a, uid: A, teamId: TIGERS, seasonId: SPRING }), /finalized\. Reopen it first/);
  await assert.rejects(setTeamCurrentSeason({ db: a, uid: A, teamId: TIGERS, seasonId: F_ACTIVE }), /doesn't belong to this team/);

  // publicTeams can never name an unpublished season or another team's season.
  const tigers = (await admin.doc(`teams/${TIGERS}`).get()).data();
  await expectDenied(setDoc(doc(a, "publicTeams", TIGERS), pub(tigers, SPRING)), "a published season that is not the team's current");
  await expectDenied(setDoc(doc(a, "publicTeams", TIGERS), pub(tigers, B_PUB)), "another team's season");
  await setTeamCurrentSeason({ db: a, uid: A, teamId: FALCONS, seasonId: F_ACTIVE });
  const falcons = (await admin.doc(`teams/${FALCONS}`).get()).data();
  await expectDenied(setDoc(doc(a, "publicTeams", FALCONS), pub(falcons, F_ACTIVE)), "unpublished current season");
  await expectDenied(setDoc(doc(a, "publicTeams", TIGERS), { ...pub(tigers, FALL), teamName: "Renamed" }), "branding differs from the team");
});

test("unpublishing hides the season, its public team pointer, and every career link to it", async () => {
  assert.ok((await links(SPRING, ALEX_SPRING)).some((l) => l.seasonId === FALL), "fixture: Spring links to Fall");
  const r = await setSeasonPublished({ db: a, uid: A, teamId: TIGERS, seasonId: FALL, published: false });
  assert.ok(r.linksChanged > 0);
  await expectDenied(read(anon, `seasons/${FALL}`), "unpublished season");
  await expectDenied(getDocs(collection(anon, "seasons", FALL, "players")), "its roster");
  assert.equal(await publicCurrent(TIGERS), null);
  // Finalized Spring 2026 entries no longer name Fall 2026 (links-only update).
  for (const d of (await admin.collection(`seasons/${SPRING}/players`).get()).docs) {
    assert.ok(!JSON.stringify(d.data().careerLinks ?? []).includes(FALL), `${d.id} still links to Fall`);
  }
  const spring = (await admin.doc(`seasons/${SPRING}`).get()).data();
  assert.equal(spring.status, "finalized", "Spring stays finalized");
  // Public career from Spring now shows Spring only.
  const p = (await read(anon, `seasons/${SPRING}/players/${ALEX_SPRING}`)).data();
  const career = await loadPublicCareer({ db: anon, seasonId: SPRING, player: { id: ALEX_SPRING, name: p.name, number: p.number, stats: {}, careerLinks: p.careerLinks }, currentSeason: { teamName: "Tigers", seasonLabel: "Spring 2026" } });
  assert.deepEqual(career.history.map((h) => h.seasonId), [SPRING]);

  // Republishing restores the season, the team's public current, and the links.
  await setSeasonPublished({ db: a, uid: A, teamId: TIGERS, seasonId: FALL, published: true });
  assert.equal(await publicCurrent(TIGERS), FALL);
  assert.deepEqual(await links(SPRING, ALEX_SPRING), [{ seasonId: FALL, seasonPlayerId: ALEX_FALL }]);
  const fall = (await read(anon, `seasons/${FALL}/players/${ALEX_FALL}`)).data();
  const both = await loadPublicCareer({ db: anon, seasonId: FALL, player: { id: ALEX_FALL, name: fall.name, number: fall.number, stats: {}, careerLinks: fall.careerLinks }, currentSeason: { teamName: "Tigers", seasonLabel: "Fall 2026" } });
  assert.deepEqual(both.history.map((h) => h.seasonId), [SPRING, FALL]);
});

test("rules: unpublishing must clear the public pointer; drafts can't be published; links are bounded", async () => {
  await expectDenied(updateDoc(doc(a, "seasons", FALL), { published: false, updatedAt: new Date() }), "unpublish while publicTeams points at it");
  await expectDenied(updateDoc(doc(a, "seasons", A_DRAFT), { published: true, updatedAt: new Date() }), "publish a draft");
  await assert.rejects(setSeasonPublished({ db: a, uid: A, teamId: TIGERS, seasonId: A_DRAFT, published: true }), /Drafts can't be published/);
  await expectDenied(updateDoc(doc(a, "seasons", SPRING, "players", ALEX_SPRING), { careerLinks: Array.from({ length: 26 }, (_, i) => ({ seasonId: `s${i}`, seasonPlayerId: "p" })) }), "more than 25 links");
  await expectDenied(updateDoc(doc(a, "seasons", SPRING, "players", ALEX_SPRING), { careerLinks: [], number: 99 }), "finalized: anything but links");
  await updateDoc(doc(a, "seasons", SPRING, "players", ALEX_SPRING), { careerLinks: [] });
});

test("cross-coach isolation: neither coach can manage the other's team; both see published parent pages", async () => {
  assert.equal(await readOwnedTeam(b, TIGERS), null, "B reads nothing of A's team");
  assert.equal(await readOwnedTeam(a, HAWKS), null, "A reads nothing of B's team");
  await assert.rejects(setTeamCurrentSeason({ db: b, uid: B, teamId: TIGERS, seasonId: FALL }));
  await assert.rejects(setSeasonPublished({ db: b, uid: B, teamId: TIGERS, seasonId: FALL, published: false }));
  await assert.rejects(setSeasonPublished({ db: a, uid: A, teamId: HAWKS, seasonId: B_PUB, published: false }));
  await expectDenied(updateDoc(doc(b, "seasons", FALL), { published: false, updatedAt: new Date() }), "B unpublishes A's season");
  await expectDenied(setDoc(doc(b, "publicTeams", TIGERS), pub((await admin.doc(`teams/${TIGERS}`).get()).data(), null)), "B rewrites A's public team");
  await expectDenied(updateDoc(doc(b, "seasons", FALL, "players", ALEX_FALL), { careerLinks: [] }), "B edits A's career links");
  await expectDenied(getDocs(query(collection(b, "seasons"), where("ownerUid", "==", A))), "B lists A's seasons");
  await expectDenied(updateDoc(doc(a, "teams", TIGERS), { ownerUid: B }), "ownership transfer");
  await expectDenied(updateDoc(doc(a, "seasons", FALL), { ownerUid: B }), "season ownership transfer");
  // Both coaches (and parents) can open each other's published parent pages.
  for (const d of [a, b, anon]) {
    assert.equal((await read(d, `publicTeams/${HAWKS}`)).data().currentSeasonId, B_PUB);
    assert.equal((await read(d, `publicTeams/${TIGERS}`)).data().currentSeasonId, FALL);
    assert.ok((await read(d, `seasons/${B_PUB}`)).exists());
    assert.ok((await read(d, `seasons/${FALL}`)).exists());
  }
  const batch = writeBatch(b);
  batch.update(doc(b, "teams", HAWKS), { currentSeasonId: FALL, updatedAt: new Date() });
  await expectDenied(batch.commit(), "B points its team at A's season");
});
