// Team-scoped Admin (Tallies Checkpoint B+) on the TARGET rules, driven
// through the app's own Admin actions with real client identities:
// onboarding, Team Designer, New Season Setup, roster, stats, lineup,
// awards, lifecycle, publication, two teams of one coach, two coaches.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";

import { PROJECT_ID, admin, clearFirestore, clientDb, closeClients, expectDenied } from "./support.mjs";
import { LEGACY_TIGERS_BRANDING, newTeamTemplate } from "../../src/lib/branding.ts";
import {
  addPlayersToRoster,
  createSeasonOrResume,
  deleteDraftSeason,
  finalizeSeason,
  makeCurrentSeason,
  removeRosterPlayer,
  reopenSeason,
  saveGameAndApplyDeltas,
  savePlayerEdits,
} from "../../src/app/(protected)/admin/_parts/adminActions.ts";
import { EMPTY_COACH_PICKS, EMPTY_DELTA } from "../../src/app/(protected)/admin/adminHelpers.ts";
import {
  createScopedTeam,
  listScopedSeasons,
  readScopedTeam,
  updateScopedTeam,
} from "../../src/lib/teamData.ts";
import { setSeasonPublished } from "../../src/lib/teamPublication.ts";
import { saveCurrentLineup } from "../../src/lib/lineupStore.ts";
import { saveRecognitionLayout } from "../../src/lib/recognitionLayoutStore.ts";

const TARGET = fs.readFileSync("firestore.target.rules", "utf8");
const REPO = fs.readFileSync("firestore.rules", "utf8");
const N = "coach-new";
const B = "coach-b";

async function loadRules(content) {
  const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}:securityRules`, {
    method: "PUT",
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }),
  });
  if (!res.ok) throw new Error(`rules load failed: ${res.status}`);
}

let anon, n, b, stranger;
before(async () => {
  await loadRules(TARGET);
  anon = clientDb(null);
  n = clientDb(N);
  b = clientDb(B);
  stranger = clientDb("not-approved");
});
after(async () => {
  await loadRules(REPO);
  await closeClients();
});

beforeEach(async () => {
  await clearFirestore();
  const batch = admin.batch();
  batch.set(admin.doc(`coaches/${N}`), { status: "active", workspaceId: "ws-n", inviteId: "inv-n" });
  batch.set(admin.doc(`coaches/${B}`), { status: "active", workspaceId: "ws-b", inviteId: "inv-b" });
  batch.set(admin.doc("coachWorkspaces/ws-n"), { ownerUid: N, status: "active" });
  batch.set(admin.doc("coachWorkspaces/ws-b"), { ownerUid: B, status: "active" });
  batch.set(admin.doc("app/config"), { currentSeasonId: "legacy-season" });
  await batch.commit();
});

/** The scope the workspace builds for a coach (and, after reading it, a team). */
async function scopeFor(db, uid, ws, teamId = null) {
  const s = { uid, workspaceId: ws, team: null, seasonIds: null, refresh() {} };
  if (!teamId) return s;
  s.team = await readScopedTeam(db, teamId);
  const seasons = await listScopedSeasons(db, s);
  s.seasonIds = new Set(seasons.map((x) => x.seasonId));
  return s;
}

const draftTeam = (teamId, name, extra = {}) => ({ ...newTeamTemplate(), teamName: name, shortName: name.slice(0, 3).toUpperCase(), division: "8U", ...extra, teamId });
const player = (id, name, number, stats = {}) => ({ id, name, number, stats: { ...EMPTY_DELTA, games: 0, plateAppearances: 0, ...stats } });

async function firstTeamWithSeason(db, uid, ws, teamId, name) {
  const s0 = await scopeFor(db, uid, ws);
  assert.equal(await createScopedTeam(db, s0, draftTeam(teamId, name)), "created");
  let s = await scopeFor(db, uid, ws, teamId);
  const team = s.team;
  const { seasonId } = await createSeasonOrResume({ db, uid, team, seasonId: "ignored", seasonLabel: "Fall 2026", scheduledGames: 10, existingSeasonIds: [], scope: s });
  s = await scopeFor(db, uid, ws, teamId);
  return { s, seasonId };
}

test("onboarding: an approved coach creates a first team they own; retries recover; unapproved users can't", async () => {
  const s = await scopeFor(n, N, "ws-n");
  const team = draftTeam("t_aaaaaaaaaaaaaaaaaaaa", "Comets");
  assert.equal(await createScopedTeam(n, s, team), "created");
  assert.equal(await createScopedTeam(n, s, team), "recovered", "a retried submit does not duplicate");
  const doc1 = (await admin.doc("teams/t_aaaaaaaaaaaaaaaaaaaa").get()).data();
  assert.equal(doc1.ownerUid, N);
  assert.equal(doc1.workspaceId, "ws-n");
  assert.ok(!("currentSeasonId" in doc1));
  const pub = (await getDoc(doc(anon, "publicTeams", "t_aaaaaaaaaaaaaaaaaaaa"))).data();
  assert.equal(pub.teamName, "Comets");
  assert.equal(pub.currentSeasonId, null);
  assert.ok(!("ownerUid" in pub));
  await assert.rejects(createScopedTeam(b, await scopeFor(b, B, "ws-b"), { ...team, teamName: "Other" }), "another coach can't take the id");
  await assert.rejects(createScopedTeam(stranger, { uid: "not-approved", workspaceId: "ws-x", team: null, seasonIds: null, refresh() {} }, draftTeam("t_bbbbbbbbbbbbbbbbbbbb", "Nope")));
  assert.equal((await admin.doc("teams/t_bbbbbbbbbbbbbbbbbbbb").get()).exists, false);
  await expectDenied(updateDoc(doc(n, "teams", "t_aaaaaaaaaaaaaaaaaaaa"), { ownerUid: B }), "ownership is immutable");
  await expectDenied(updateDoc(doc(n, "teams", "t_aaaaaaaaaaaaaaaaaaaa"), { workspaceId: "ws-b" }), "workspace is immutable");
});

test("Team Designer: identity and colors persist, the public projection follows, finalized history keeps its branding", async () => {
  const { s, seasonId } = await firstTeamWithSeason(n, N, "ws-n", "t_cccccccccccccccccccc", "Rockets");
  await makeCurrentSeason({ db: n, seasonId, uid: N, scope: s });
  const s2 = await scopeFor(n, N, "ws-n", "t_cccccccccccccccccccc");
  await finalizeSeason({ db: n, uid: N, seasonId, scope: s2 });
  const before = (await admin.doc(`seasons/${seasonId}`).get()).data().branding;
  const recolored = structuredClone(s2.team);
  recolored.teamName = "Rockets Blue";
  recolored.palettes.dark.primary = "#1d4ed8";
  await updateScopedTeam(n, s2, recolored);
  const team = (await admin.doc("teams/t_cccccccccccccccccccc").get()).data();
  assert.equal(team.teamName, "Rockets Blue");
  assert.equal(team.palettes.dark.primary, "#1d4ed8");
  assert.equal(team.ownerUid, N);
  assert.equal(team.currentSeasonId, seasonId, "current season untouched");
  assert.equal((await getDoc(doc(anon, "publicTeams", "t_cccccccccccccccccccc"))).data().teamName, "Rockets Blue");
  assert.deepEqual((await admin.doc(`seasons/${seasonId}`).get()).data().branding, before, "finalized season keeps its snapshot");
  await assert.rejects(updateScopedTeam(n, s2, { ...recolored, teamId: "t_other" }), /only edit the selected team/);
});

test("New Season Setup: opaque draft ids, resume instead of duplicate, activation, publication", async () => {
  const { s, seasonId } = await firstTeamWithSeason(n, N, "ws-n", "t_dddddddddddddddddddd", "Comets");
  assert.match(seasonId, /^s_[0-9a-f]{20}$/);
  const again = await createSeasonOrResume({ db: n, uid: N, team: s.team, seasonId: "x", seasonLabel: "Fall 2026", scheduledGames: 10, existingSeasonIds: [], scope: s });
  assert.deepEqual(again, { seasonId, outcome: "resumed" });
  const d = (await admin.doc(`seasons/${seasonId}`).get()).data();
  assert.equal(d.status, "draft");
  assert.equal(d.published, false);
  assert.equal(d.ownerUid, N);
  assert.equal(d.teamId, "t_dddddddddddddddddddd");
  assert.equal(d.scheduledGames, 10);
  assert.equal(d.branding.teamName, "Comets");
  for (const k of ["coachUids", "lifecycleHistory"]) assert.ok(!(k in d), k);
  await expectDenied(getDoc(doc(anon, "seasons", seasonId)), "draft hidden");
  await assert.rejects(setSeasonPublished({ db: n, uid: N, teamId: s.team.teamId, seasonId, published: true }), /Drafts can't be published/);

  await makeCurrentSeason({ db: n, seasonId, uid: N, scope: s });
  assert.equal((await admin.doc("teams/t_dddddddddddddddddddd").get()).data().currentSeasonId, seasonId);
  assert.equal((await admin.doc("app/config").get()).data().currentSeasonId, "legacy-season", "global setting untouched");
  assert.deepEqual((await admin.doc(`seasons/${seasonId}/private/audit`).get()).data().lifecycleHistory.map((e) => e.action), ["activated"]);
  assert.equal((await getDoc(doc(anon, "publicTeams", "t_dddddddddddddddddddd"))).data().currentSeasonId, null, "activated but unpublished stays hidden");
  await setSeasonPublished({ db: n, uid: N, teamId: "t_dddddddddddddddddddd", seasonId, published: true });
  assert.equal((await getDoc(doc(anon, "publicTeams", "t_dddddddddddddddddddd"))).data().currentSeasonId, seasonId);
  assert.ok((await getDoc(doc(anon, "seasons", seasonId))).exists());
});

test("roster: private fields stay private, ids don't reveal identities, edits and removal are scoped", async () => {
  const { s, seasonId } = await firstTeamWithSeason(n, N, "ws-n", "t_eeeeeeeeeeeeeeeeeeee", "Comets");
  const res = await addPlayersToRoster({
    db: n,
    seasonId,
    imports: [],
    newPlayers: [
      { careerPlayerId: "11111111-1111-4111-8111-111111111111", name: "Ava Stone", number: "7", primaryPos: "", shirtSize: "YM" },
      { careerPlayerId: "22222222-2222-4222-8222-222222222222", name: "Ben Ortiz", number: "12", primaryPos: "", shirtSize: "YL" },
    ],
    scope: s,
  });
  assert.equal(res.writes.length, 2);
  const docs = await admin.collection(`seasons/${seasonId}/players`).get();
  assert.equal(docs.size, 2);
  for (const d of docs.docs) {
    assert.match(d.id, /^sp_[0-9a-f]{20}$/, "doc id is not the identity");
    for (const k of ["shirtSize", "careerPlayerId", "identityStatus", "linkedFrom"]) assert.ok(!(k in d.data()), `${k} not public`);
    const prof = (await d.ref.collection("private").doc("profile").get()).data();
    assert.match(prof.careerPlayerId, /-/);
    assert.ok(["YM", "YL"].includes(prof.shirtSize));
  }
  const again = await addPlayersToRoster({
    db: n,
    seasonId,
    imports: [],
    newPlayers: [{ careerPlayerId: "11111111-1111-4111-8111-111111111111", name: "Ava Stone", number: "7", primaryPos: "", shirtSize: "YM" }],
    scope: s,
  });
  assert.equal(again.writes.length, 0, "re-submitting adds nobody twice");

  const ava = docs.docs.find((d) => d.data().name === "Ava Stone");
  await savePlayerEdits({
    db: n,
    seasonId,
    players: [{ id: ava.id, careerPlayerId: "11111111-1111-4111-8111-111111111111", name: "Ava Stone", number: 7, stats: {} }],
    edits: { [ava.id]: { name: "Ava Stone-Lee", number: "8", shirtSize: "AS", leaderboardHidden: false, returningPlayer: false, dirty: true } },
    scope: s,
  });
  const after = (await ava.ref.get()).data();
  assert.equal(after.name, "Ava Stone-Lee");
  assert.equal(after.number, 8);
  assert.ok(!("shirtSize" in after));
  assert.equal((await ava.ref.collection("private").doc("profile").get()).data().shirtSize, "AS");
  assert.equal((await ava.ref.collection("private").doc("profile").get()).data().careerPlayerId, "11111111-1111-4111-8111-111111111111", "identity kept");
  await expectDenied(getDoc(doc(anon, "seasons", seasonId, "players", ava.id, "private", "profile")), "private profile");

  const ben = docs.docs.find((d) => d.data().name === "Ben Ortiz");
  await removeRosterPlayer({ db: n, seasonId, seasonPlayerId: ben.id, confirmName: "Ben Ortiz", scope: s });
  assert.equal((await ben.ref.get()).exists, false);
  assert.equal((await ben.ref.collection("private").doc("profile").get()).exists, false, "private profile removed with it");
});

test("stats, lineup, awards, and recognition persist on the team's current season; finalized seasons are frozen", async () => {
  const { s, seasonId } = await firstTeamWithSeason(n, N, "ws-n", "t_ffffffffffffffffffff", "Comets");
  await addPlayersToRoster({ db: n, seasonId, imports: [], newPlayers: [{ careerPlayerId: "33333333-3333-4333-8333-333333333333", name: "Cam Lee", number: "3", primaryPos: "", shirtSize: "" }], scope: s });
  await makeCurrentSeason({ db: n, seasonId, uid: N, scope: s });
  const pid = (await admin.collection(`seasons/${seasonId}/players`).get()).docs[0].id;
  const cam = player(pid, "Cam Lee", 3);
  await saveCurrentLineup(n, { seasonId, title: "Game 1", inningCount: 3, rows: [], createdAtISO: "" });
  const lines = { [pid]: { hidden: false, delta: { ...EMPTY_DELTA, atBats: 3, hits: 2, doubles: 1, walks: 1, rbi: 2, stolenBases: 1, hitByPitch: 0, pitchingStrikeouts: 2 } } };
  const saved = await saveGameAndApplyDeltas({
    db: n, seasonId, date: "2026-09-05", opponent: "Owls", result: "W", gameType: "scrimmage", scoreUs: "6", scoreThem: "2",
    players: [cam], lines, coachPicks: { ...EMPTY_COACH_PICKS, charlieHustle: pid }, gameBallPlayerId: pid,
  });
  const st = (await admin.doc(`seasons/${seasonId}/players/${pid}`).get()).data().stats;
  assert.equal(st.hits, 2);
  assert.equal(st.doubles, 1);
  assert.equal(st.walks, 1);
  assert.equal(st.pitchingStrikeouts, 2);
  assert.equal(st.charlieHustleAwards, 1);
  assert.ok(!("strikeouts" in st), "no batter strikeouts tracked");
  const g = (await admin.doc(`seasons/${seasonId}/games/${saved.gameId}`).get()).data();
  assert.equal(g.gameType, "scrimmage");
  assert.equal(g.gameBall.playerId, pid);
  assert.ok((await admin.doc(`seasons/${seasonId}/lineups/current`).get()).exists);

  await setDoc(doc(n, "seasons", seasonId), { endSeasonMode: true, finalAwards: { mvp: pid, dominator: "", honorableMention: "", bestAllAround: "", bestAttitude: "" }, updatedAt: new Date() }, { merge: true });
  await saveRecognitionLayout({ db: n, seasonId, playerId: pid, order: ["mvp"] });
  const sd = (await admin.doc(`seasons/${seasonId}`).get()).data();
  assert.equal(sd.finalAwards.mvp, pid);
  assert.ok(sd.recognitionLayouts[pid]);

  await finalizeSeason({ db: n, uid: N, seasonId, scope: s });
  const frozen = JSON.stringify((await admin.doc(`seasons/${seasonId}/players/${pid}`).get()).data());
  await assert.rejects(savePlayerEdits({ db: n, seasonId, players: [cam], edits: { [pid]: { name: "X", number: "1", shirtSize: "", leaderboardHidden: false, returningPlayer: false, dirty: true } }, scope: s }), /finalized/);
  await expectDenied(setDoc(doc(n, "seasons", seasonId, "games", "g2"), { opponent: "Late" }), "no games on finalized");
  await expectDenied(updateDoc(doc(n, "seasons", seasonId), { finalAwards: { mvp: "" } }), "awards frozen");
  assert.equal(JSON.stringify((await admin.doc(`seasons/${seasonId}/players/${pid}`).get()).data()), frozen);
  const audit = (await admin.doc(`seasons/${seasonId}/private/audit`).get()).data();
  assert.deepEqual(audit.lifecycleHistory.map((e) => e.action), ["activated", "finalized"]);
  assert.equal(audit.finalizedByUid, N);
  await reopenSeason({ db: n, uid: N, seasonId, scope: s });
  assert.equal((await admin.doc(`seasons/${seasonId}`).get()).data().status, "active");
});

test("draft deletion removes the draft, its roster, private profiles, and audit; never the current season", async () => {
  const { s, seasonId } = await firstTeamWithSeason(n, N, "ws-n", "t_gggggggggggggggggggg", "Comets");
  await addPlayersToRoster({ db: n, seasonId, imports: [], newPlayers: [{ careerPlayerId: "44444444-4444-4444-8444-444444444444", name: "Dee Fox", number: "4", primaryPos: "", shirtSize: "" }], scope: s });
  const res = await deleteDraftSeason({ db: n, uid: N, seasonId, scope: s });
  assert.deepEqual(res, { outcome: "deleted", removedPlayers: 1 });
  assert.equal((await admin.doc(`seasons/${seasonId}`).get()).exists, false);
  assert.equal((await admin.collection(`seasons/${seasonId}/players`).get()).size, 0);
  assert.equal((await admin.doc(`seasons/${seasonId}/private/audit`).get()).exists, false);
  const left = await admin.collectionGroup("private").get();
  assert.equal(left.docs.filter((d) => d.ref.path.includes(seasonId)).length, 0, "no orphaned private docs");

  const { s: s2, seasonId: cur } = await firstTeamWithSeason(n, N, "ws-n", "t_hhhhhhhhhhhhhhhhhhhh", "Owls");
  await makeCurrentSeason({ db: n, seasonId: cur, uid: N, scope: s2 });
  await assert.rejects(deleteDraftSeason({ db: n, uid: N, seasonId: cur, scope: s2 }));
  assert.ok((await admin.doc(`seasons/${cur}`).get()).exists);
});

test("one coach, two teams: every scoped action refuses the other team's seasons; current seasons are independent", async () => {
  const A = await firstTeamWithSeason(n, N, "ws-n", "t_iiiiiiiiiiiiiiiiiiii", "Comets");
  const Bt = await firstTeamWithSeason(n, N, "ws-n", "t_jjjjjjjjjjjjjjjjjjjj", "Owls");
  const sA = await scopeFor(n, N, "ws-n", "t_iiiiiiiiiiiiiiiiiiii");
  const other = Bt.seasonId;
  await assert.rejects(makeCurrentSeason({ db: n, seasonId: other, uid: N, scope: sA }), /doesn't belong/);
  await assert.rejects(addPlayersToRoster({ db: n, seasonId: other, imports: [], newPlayers: [{ careerPlayerId: "55555555-5555-4555-8555-555555555555", name: "X", number: "1", primaryPos: "", shirtSize: "" }], scope: sA }), /isn't part of Comets/);
  await assert.rejects(finalizeSeason({ db: n, uid: N, seasonId: other, scope: sA }), /isn't part of Comets/);
  await assert.rejects(deleteDraftSeason({ db: n, uid: N, seasonId: other, scope: sA }), /isn't part of Comets/);
  await assert.rejects(savePlayerEdits({ db: n, seasonId: other, players: [player("p", "P", 1)], edits: { p: { name: "Q", number: "1", shirtSize: "", leaderboardHidden: false, returningPlayer: false, dirty: true } }, scope: sA }), /isn't part of Comets/);
  assert.equal((await admin.collection(`seasons/${other}/players`).get()).size, 0, "nothing written into the other team");

  await makeCurrentSeason({ db: n, seasonId: A.seasonId, uid: N, scope: sA });
  assert.equal((await admin.doc("teams/t_iiiiiiiiiiiiiiiiiiii").get()).data().currentSeasonId, A.seasonId);
  assert.equal((await admin.doc("teams/t_jjjjjjjjjjjjjjjjjjjj").get()).data().currentSeasonId, undefined);
  // Rules: a team's current season must be one of its own seasons.
  await expectDenied(updateDoc(doc(n, "teams", "t_jjjjjjjjjjjjjjjjjjjj"), { currentSeasonId: A.seasonId }), "cross-team current season");
  // Returning players only from this team's seasons.
  await assert.rejects(
    addPlayersToRoster({ db: n, seasonId: A.seasonId, newPlayers: [], imports: [{ careerPlayerId: "66666666-6666-4666-8666-666666666666", name: "Z", number: "1", primaryPos: "", shirtSize: "", linkedFrom: [{ seasonId: other, seasonPlayerId: "x" }] }], scope: sA }),
    /only come from this team/,
  );
});

test("two coaches: neither can read or change the other's team, seasons, roster, or private data", async () => {
  const mine = await firstTeamWithSeason(n, N, "ws-n", "t_kkkkkkkkkkkkkkkkkkkk", "Comets");
  await addPlayersToRoster({ db: n, seasonId: mine.seasonId, imports: [], newPlayers: [{ careerPlayerId: "77777777-7777-4777-8777-777777777777", name: "Eli Ray", number: "9", primaryPos: "", shirtSize: "YS" }], scope: mine.s });
  const pid = (await admin.collection(`seasons/${mine.seasonId}/players`).get()).docs[0].id;
  assert.equal(await readScopedTeam(b, "t_kkkkkkkkkkkkkkkkkkkk"), null);
  const forged = { uid: B, workspaceId: "ws-b", team: mine.s.team, seasonIds: mine.s.seasonIds, refresh() {} };
  await assert.rejects(makeCurrentSeason({ db: b, seasonId: mine.seasonId, uid: B, scope: forged }), "a forged scope gets nothing");
  await assert.rejects(addPlayersToRoster({ db: b, seasonId: mine.seasonId, imports: [], newPlayers: [{ careerPlayerId: "88888888-8888-4888-8888-888888888888", name: "Spy", number: "1", primaryPos: "", shirtSize: "" }], scope: forged }));
  await assert.rejects(updateScopedTeam(b, forged, { ...mine.s.team, teamName: "Taken" }));
  await expectDenied(getDoc(doc(b, "seasons", mine.seasonId, "players", pid, "private", "profile")), "B reads A's private profile");
  await expectDenied(getDocs(collection(b, "seasons", mine.seasonId, "players")), "B reads A's unpublished roster");
  assert.equal((await admin.collection(`seasons/${mine.seasonId}/players`).get()).size, 1);
  assert.equal((await admin.doc("teams/t_kkkkkkkkkkkkkkkkkkkk").get()).data().teamName, "Comets");
});

test("Tigers template stays available and unchanged for new teams", async () => {
  const s = await scopeFor(n, N, "ws-n");
  const team = { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "t_llllllllllllllllllll" };
  await createScopedTeam(n, s, team);
  const d = (await admin.doc("teams/t_llllllllllllllllllll").get()).data();
  assert.deepEqual(d.palettes, LEGACY_TIGERS_BRANDING.palettes);
  assert.deepEqual(d.logo, LEGACY_TIGERS_BRANDING.logo);
});
