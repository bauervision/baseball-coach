// Season lifecycle against this repo's firestore.rules: finalization is
// enforced for direct SDK writes, not just hidden buttons.
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import { admin, clearFirestore, clientDb, closeClients, expectDenied, getData, seed } from "./support.mjs";
import {
  addPlayersToRoster,
  createSeason,
  finalizeSeason,
  makeCurrentSeason,
  removeRosterPlayer,
  reopenSeason,
  saveGameAndApplyDeltas,
  savePlayerEdits,
  updateScheduledGames,
} from "../../src/app/(protected)/admin/_parts/adminActions.ts";
import { saveCurrentLineup } from "../../src/lib/lineupStore.ts";
import { saveRecognitionLayout } from "../../src/lib/recognitionLayoutStore.ts";
import { EMPTY_COACH_PICKS, EMPTY_DELTA } from "../../src/app/(protected)/admin/adminHelpers.ts";
import { statsDigest } from "../../tools/identity/audit.mjs";
import { loadSnapshot, toJson } from "../../tools/identity/firestore.mjs";
import { COACH_UID, OTHER_COACH_UID, legacySnapshot, stats } from "../support/fixtures.mjs";

const SPRING = "tigers-2026";
const FALL = "tigers-fall-2026";
const PARENT = "parent-not-admin";

let db;
beforeEach(async () => {
  await clearFirestore();
  await seed(legacySnapshot(), [COACH_UID, OTHER_COACH_UID]);
  db = clientDb(COACH_UID);
});
after(closeClients);

async function snapshotOf(seasonId) {
  const s = toJson(await loadSnapshot(admin));
  s.seasons = s.seasons.filter((x) => x.seasonId === seasonId);
  return s;
}

function playersOf(seasonId) {
  return admin
    .collection(`seasons/${seasonId}/players`)
    .get()
    .then((q) => q.docs.map((d) => ({ id: d.id, ...d.data() })));
}

test("finalize writes only lifecycle fields, preserves history, and is idempotent", async () => {
  const before = await getData(`seasons/${SPRING}`);
  const digest = statsDigest(await snapshotOf(SPRING));

  assert.deepEqual(await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING }), { alreadyFinalized: false });
  const after1 = await getData(`seasons/${SPRING}`);
  assert.equal(after1.status, "finalized");
  assert.equal(after1.finalizedByUid, COACH_UID);
  assert.ok(after1.finalizedAt);
  assert.equal(after1.lifecycleHistory.length, 1);
  assert.equal(after1.lifecycleHistory[0].fromStatus, "legacy");
  for (const k of ["record", "endSeasonMode", "finalAwards", "seasonLabel", "teamName"]) {
    assert.deepEqual(after1[k], before[k], `${k} unchanged`);
  }
  assert.equal(statsDigest(await snapshotOf(SPRING)), digest, "players, stats, games, lines unchanged");

  assert.deepEqual(await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING }), { alreadyFinalized: true });
  assert.equal((await getData(`seasons/${SPRING}`)).lifecycleHistory.length, 1, "no duplicate event");
});

test("a finalized season rejects every direct write path, even from the coach", async () => {
  await finalizeSeason({ db, uid: COACH_UID, seasonId: FALL });
  const digest = statsDigest(await snapshotOf(FALL));
  const seasonBefore = await getData(`seasons/${FALL}`);
  const S = (...p) => doc(db, "seasons", FALL, ...p);

  // Season doc: record, awards, layouts, metadata, deletion.
  await expectDenied(setDoc(S(), { record: { wins: 0, losses: 0, ties: 0 } }, { merge: true }));
  await expectDenied(setDoc(S(), { endSeasonMode: false, finalAwards: {} }, { merge: true }));
  await expectDenied(updateDoc(S(), "recognitionLayouts.07-ava-carter", deleteField()));
  await expectDenied(updateDoc(S(), { seasonLabel: "Renamed" }));
  await expectDenied(deleteDoc(S()));
  // Roster, stats, games, lines, lineups, and unknown subcollections.
  await expectDenied(updateDoc(S("players", "07-ava-carter"), { "stats.hits": 99 }));
  await expectDenied(setDoc(S("players", "new-kid"), { name: "New", number: 1 }));
  await expectDenied(deleteDoc(S("players", "11-finn-hale")));
  await expectDenied(setDoc(S("games", "g-new"), { date: "2026-10-01", opponent: "X", result: "W" }));
  await expectDenied(deleteDoc(S("games", "20260915-owls-1")));
  await expectDenied(setDoc(S("games", "20260915-owls-1", "lines", "07-ava-carter"), { playerId: "07-ava-carter", delta: { hits: 5 } }));
  await expectDenied(setDoc(S("lineups", "current"), { rows: [] }));
  await expectDenied(setDoc(S("notes", "n1"), { text: "x" }));
  // Batches and transactions fail atomically.
  const batch = writeBatch(db);
  batch.set(doc(db, "seasons", SPRING, "players", "ok-elsewhere"), { name: "Fine", number: 2 });
  batch.update(S("players", "07-ava-carter"), { number: 70 });
  await expectDenied(batch.commit());
  assert.equal(await getData(`seasons/${SPRING}/players/ok-elsewhere`), null, "nothing from the batch applied");
  await expectDenied(
    runTransaction(db, async (tx) => {
      await tx.get(S("players", "07-ava-carter"));
      tx.update(S("players", "07-ava-carter"), { number: 71 });
    }),
  );

  // App write paths give a clear message (and rules would reject anyway).
  const roster = await playersOf(FALL);
  const lines = Object.fromEntries(roster.map((p) => [p.id, { hidden: false, delta: { ...EMPTY_DELTA, atBats: 1, hits: 1 } }]));
  await assert.rejects(
    saveGameAndApplyDeltas({ db, seasonId: FALL, date: "2026-10-30", opponent: "Late", result: "W", gameType: "regular", scoreUs: "1", scoreThem: "0", players: roster, lines, coachPicks: { ...EMPTY_COACH_PICKS }, gameBallPlayerId: "" }),
    /finalized and read-only/,
  );
  await assert.rejects(updateScheduledGames({ db, seasonId: FALL, scheduledGames: 12 }), /finalized/);
  await assert.rejects(
    savePlayerEdits({ db, seasonId: FALL, players: roster, edits: { [roster[0].id]: { name: "X", number: "1", shirtSize: "", leaderboardHidden: false, returningPlayer: false, dirty: true } } }),
    /finalized/,
  );
  await assert.rejects(
    addPlayersToRoster({ db, seasonId: FALL, imports: [], newPlayers: [{ careerPlayerId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Late Add", number: "", primaryPos: "", shirtSize: "" }] }),
    /finalized/,
  );
  await assert.rejects(removeRosterPlayer({ db, seasonId: FALL, seasonPlayerId: "11-finn-hale", confirmName: "Finn Hale" }), /finalized/);
  await expectDenied(saveRecognitionLayout({ db, seasonId: FALL, playerId: "07-ava-carter", order: ["x"] }));
  await expectDenied(saveCurrentLineup(db, { seasonId: FALL, id: "current", inningCount: 6, rows: [] }));

  assert.equal(statsDigest(await snapshotOf(FALL)), digest, "nothing changed");
  assert.deepEqual(await getData(`seasons/${FALL}`), seasonBefore);
});

test("finalized seasons stay readable by parents and anonymous viewers", async () => {
  await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING });
  for (const viewer of [clientDb(null), clientDb(PARENT)]) {
    assert.equal((await getDoc(doc(viewer, "seasons", SPRING))).data().status, "finalized");
    assert.ok((await getDocs(collection(viewer, "seasons", SPRING, "players"))).size > 0);
    assert.ok((await getDocs(collection(viewer, "seasons", SPRING, "games", "20260410-bears-1", "lines"))).size > 0);
  }
});

test("forged lifecycle transitions and audit tampering are rejected", async () => {
  const S = doc(db, "seasons", SPRING);
  // Finalize while also changing data.
  await expectDenied(updateDoc(S, { status: "finalized", finalizedByUid: COACH_UID, lifecycleHistory: [{ action: "finalized", at: "t", byUid: COACH_UID }], record: { wins: 9, losses: 0 } }));
  // Finalize attributed to someone else, or without an audit entry.
  await expectDenied(updateDoc(S, { status: "finalized", finalizedByUid: OTHER_COACH_UID, lifecycleHistory: [{ action: "finalized", at: "t", byUid: OTHER_COACH_UID }] }));
  await expectDenied(updateDoc(S, { status: "finalized", finalizedByUid: COACH_UID }));
  // Batch that finalizes and edits a subcollection together.
  const b = writeBatch(db);
  b.update(S, { status: "finalized", finalizedByUid: COACH_UID, lifecycleHistory: [{ action: "finalized", at: "t", byUid: COACH_UID }] });
  b.update(doc(db, "seasons", SPRING, "players", "07-ava-carter"), { "stats.hits": 50 });
  await expectDenied(b.commit());
  // Ordinary edits may not touch status or audit fields.
  await expectDenied(updateDoc(S, { status: "draft" }));
  await expectDenied(updateDoc(S, { lifecycleHistory: [] }));
  await expectDenied(updateDoc(S, { finalizedAt: "2026-01-01" }));

  // Rewriting history after a real finalize/reopen is rejected.
  await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING });
  await reopenSeason({ db, uid: COACH_UID, seasonId: SPRING });
  const hist = (await getData(`seasons/${SPRING}`)).lifecycleHistory;
  await expectDenied(updateDoc(S, { lifecycleHistory: hist.slice(1) }));
  await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING });
  const tampered = (await getData(`seasons/${SPRING}`)).lifecycleHistory.map((e, i) => (i === 0 ? { ...e, byUid: "someone" } : e));
  await expectDenied(updateDoc(S, { status: "active", reopenedByUid: COACH_UID, lifecycleHistory: [...tampered, { action: "reopened", at: "t", byUid: COACH_UID }] }));
  // Reopen combined with an edit in the same batch is rejected.
  const b2 = writeBatch(db);
  b2.update(S, { status: "active", reopenedByUid: COACH_UID, lifecycleHistory: [...(await getData(`seasons/${SPRING}`)).lifecycleHistory, { action: "reopened", at: "t", byUid: COACH_UID }] });
  b2.update(doc(db, "seasons", SPRING, "players", "07-ava-carter"), { number: 1 });
  await expectDenied(b2.commit());
  assert.equal((await getData(`seasons/${SPRING}`)).status, "finalized");
});

test("reopen: head coach only, audited, editable again, never made current", async () => {
  await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING });
  const first = await getData(`seasons/${SPRING}`);

  // A signed-in non-admin (e.g. a parent) cannot reopen.
  const parent = clientDb(PARENT);
  await expectDenied(
    updateDoc(doc(parent, "seasons", SPRING), {
      status: "active",
      reopenedByUid: PARENT,
      lifecycleHistory: [...first.lifecycleHistory, { action: "reopened", at: "t", byUid: PARENT }],
    }),
  );

  await reopenSeason({ db, uid: COACH_UID, seasonId: SPRING });
  const reopened = await getData(`seasons/${SPRING}`);
  assert.equal(reopened.status, "active");
  assert.equal(reopened.reopenedByUid, COACH_UID);
  assert.equal(reopened.lifecycleHistory.length, 2);
  assert.deepEqual(reopened.lifecycleHistory[0], first.lifecycleHistory[0], "finalization kept");
  assert.equal(reopened.lifecycleHistory[1].action, "reopened");
  assert.equal(reopened.lifecycleHistory[1].previousFinalizedByUid, COACH_UID);
  assert.ok(reopened.lifecycleHistory[1].previousFinalizedAt);
  assert.deepEqual(reopened.record, first.record);
  assert.deepEqual(reopened.finalAwards, first.finalAwards);
  assert.equal((await getData("app/config")).currentSeasonId, FALL, "not made current");

  // Editable again.
  await updateScheduledGames({ db, seasonId: SPRING, scheduledGames: 11 });
  assert.equal((await getData(`seasons/${SPRING}`)).scheduledGames, 11);
  await assert.rejects(reopenSeason({ db, uid: COACH_UID, seasonId: SPRING }), /Only a finalized/);
});

test("make current: refuses finalized seasons; activates drafts with an audit entry", async () => {
  await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING });
  await assert.rejects(makeCurrentSeason({ db, seasonId: SPRING, uid: COACH_UID }), /finalized/);
  assert.equal((await getData("app/config")).currentSeasonId, FALL);

  await createSeason({ db, uid: COACH_UID, seasonId: "broncos-spring-2027", existingSeasonIds: [], teamName: "Broncos", teamId: "broncos", seasonLabel: "Spring 2027", usesGamesPlayedRecord: false, scheduledGames: 10, fallbackTeamName: "Team" });
  assert.equal((await getData("seasons/broncos-spring-2027")).status, "draft");
  await makeCurrentSeason({ db, seasonId: "broncos-spring-2027", uid: COACH_UID });
  const s = await getData("seasons/broncos-spring-2027");
  assert.equal(s.status, "active");
  assert.equal(s.lifecycleHistory[0].action, "activated");
  assert.equal((await getData("app/config")).currentSeasonId, "broncos-spring-2027");
  // A coach cannot create a season directly as finalized.
  await expectDenied(setDoc(doc(db, "seasons", "sneaky-2027"), { teamName: "X", seasonLabel: "Y", status: "finalized" }));
});

test("open seasons stay fully editable, including a realistic 15-player game save", async () => {
  // Rules read the season doc on every subcollection write; make sure a
  // full game save (16+ writes per batch) stays within rules limits.
  const batch = admin.batch();
  for (let i = 0; i < 9; i++) {
    batch.set(admin.doc(`seasons/${FALL}/players/x${i}`), { name: `Extra ${i}`, number: 40 + i, stats: stats() });
  }
  await batch.commit();
  const roster = await playersOf(FALL);
  assert.equal(roster.length, 15);
  const lines = Object.fromEntries(roster.map((p) => [p.id, { hidden: false, delta: { ...EMPTY_DELTA, atBats: 2, hits: 1 } }]));
  const res = await saveGameAndApplyDeltas({
    db, seasonId: FALL, date: "2026-10-05", opponent: "Big Roster", result: "L", gameType: "regular",
    scoreUs: "2", scoreThem: "3", players: roster, lines, coachPicks: { ...EMPTY_COACH_PICKS }, gameBallPlayerId: roster[0].id,
  });
  assert.equal(res.wroteLines, 15);
  assert.equal((await getData(`seasons/${FALL}/players/x0`)).stats.hits, 1);
});
