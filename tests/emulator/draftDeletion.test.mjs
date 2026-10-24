// Draft season deletion against this repo's firestore.rules and the real
// deletion function (lock → verify → delete), on the production-shaped
// fixture. Emulator only.
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deleteDoc, doc, runTransaction, setDoc, updateDoc } from "firebase/firestore";

import { PROJECT_ID, admin, clearFirestore, clientDb, closeClients, expectDenied, getData, seed } from "./support.mjs";
import {
  addPlayersToRoster,
  createSeasonOrResume,
  deleteDraftSeason,
  finalizeSeason,
  makeCurrentSeason,
} from "../../src/app/(protected)/admin/_parts/adminActions.ts";
import { ensureManagedIdentity, linkExistingChild } from "../../src/lib/coachPlayersStore.ts";
import { LEGACY_TIGERS_BRANDING } from "../../src/lib/branding.ts";
import { loadSnapshot, toJson } from "../../tools/identity/firestore.mjs";
import { COACH_UID } from "../support/fixtures.mjs";
import { PS_IDS, productionShapedSnapshot } from "../support/productionShapedFixture.mjs";

const REPO_RULES = fs.readFileSync("firestore.rules", "utf8");
const LIVE_RULES = fs.readFileSync("tests/support/deployed-2026-10-23.firestore.rules", "utf8");
const SPRING = "tigers-2026";
const FALL = "tigers-fall-2026";
const DRAFT = "tigers-spring-2027";
const TIGERS = { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "tigers-0001" };

async function loadRules(content) {
  const res = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}:securityRules`,
    { method: "PUT", body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }) },
  );
  if (!res.ok) throw new Error(`rules load failed: ${res.status}`);
}

let db;
beforeEach(async () => {
  await loadRules(REPO_RULES);
  await clearFirestore();
  await seed(productionShapedSnapshot({ migrated: true }), [COACH_UID]);
  await admin.doc(`teams/${TIGERS.teamId}`).set({ ...TIGERS, createdAt: new Date(), updatedAt: new Date() });
  db = clientDb(COACH_UID);
});
after(async () => {
  await loadRules(REPO_RULES);
  await closeClients();
});

const draft = (id = DRAFT, label = "Spring 2027") =>
  createSeasonOrResume({ db, uid: COACH_UID, team: TIGERS, seasonId: id, seasonLabel: label, scheduledGames: 12, existingSeasonIds: [SPRING, FALL] });
const del = (id = DRAFT, d = db) => deleteDraftSeason({ db: d, uid: COACH_UID, seasonId: id });
const exists = async (path) => (await admin.doc(path).get()).exists;
const players = async (id) => (await admin.collection(`seasons/${id}/players`).get()).docs.map((d) => d.id).sort();

// Everything except the draft: both Tigers seasons (all subcollections),
// config, team, identities, and linked children.
async function everythingElse() {
  const s = toJson(await loadSnapshot(admin));
  delete s.exportedAt;
  s.seasons = s.seasons.filter((x) => x.seasonId !== DRAFT);
  s.raw.seasons = s.raw.seasons.filter((x) => x.id !== DRAFT);
  return JSON.stringify(s);
}

async function importRoster() {
  const alex = (await admin.doc(`seasons/${FALL}/players/21-alex-rivera`).get()).data();
  await addPlayersToRoster({
    db, seasonId: DRAFT,
    imports: [{ careerPlayerId: alex.careerPlayerId, name: alex.name, number: "21", primaryPos: "", shirtSize: "", linkedFrom: [{ seasonId: FALL, seasonPlayerId: "21-alex-rivera" }] }],
    newPlayers: [{ careerPlayerId: "eeeeeeee-0000-4000-8000-00000000000e", name: "Tess Kerr", number: "8", primaryPos: "", shirtSize: "" }],
  });
}

test("an empty draft is deleted; team, current season, and history are untouched", async () => {
  await draft();
  const before = await everythingElse();
  assert.deepEqual(await del(), { outcome: "deleted", removedPlayers: 0 });
  assert.equal(await exists(`seasons/${DRAFT}`), false);
  assert.equal(await everythingElse(), before);
  assert.equal((await getData("app/config")).currentSeasonId, FALL);
  assert.ok(await exists(`teams/${TIGERS.teamId}`), "team kept");
});

test("a draft with imported and new players: only its own roster entries go; identities and links stay", async () => {
  // The returning player's permanent identity, linked as the coach's child.
  await ensureManagedIdentity({ db, uid: COACH_UID, careerPlayerId: PS_IDS.alex, displayName: "Alex Rivera" });
  await linkExistingChild({ db, uid: COACH_UID, careerPlayerId: PS_IDS.alex, displayName: "Alex Rivera" });
  await draft();
  await importRoster();
  assert.deepEqual(await players(DRAFT), [PS_IDS.alex, "eeeeeeee-0000-4000-8000-00000000000e"].sort());
  const before = await everythingElse();

  assert.deepEqual(await del(), { outcome: "deleted", removedPlayers: 2 });
  assert.deepEqual(await players(DRAFT), []);
  assert.equal(await everythingElse(), before, "earlier rosters, stats, identity, link, team, config unchanged");
  assert.ok(await exists(`playerIdentities/${PS_IDS.alex}`));
  assert.ok(await exists(`coachProfiles/${COACH_UID}/linkedPlayers/${PS_IDS.alex}`));
  assert.ok(await exists(`seasons/${FALL}/players/21-alex-rivera`));
  assert.ok(await exists(`seasons/${SPRING}/players/p01`));
});

test("drafts never accept games, lines, lineups, or other records (so none can block or be lost)", async () => {
  await draft();
  const S = (...p) => doc(db, "seasons", DRAFT, ...p);
  await expectDenied(setDoc(S("games", "g1"), { date: "2027-03-01", opponent: "X", result: "W" }));
  await expectDenied(setDoc(S("games", "g1", "lines", "p"), { playerId: "p", delta: {} }));
  await expectDenied(setDoc(S("lineups", "current"), { id: "current", rows: [] }));
  await expectDenied(setDoc(S("notes", "n1"), { text: "x" }));
  // Roster entries are fine on a draft.
  await setDoc(S("players", "p1"), { name: "P", number: 1, stats: {} });
});

test("fail closed: records that reached a draft outside the app block deletion and nothing is removed", async () => {
  for (const [label, path, data] of [
    ["games", `seasons/${DRAFT}/games/g1`, { date: "2027-03-01" }],
    ["lineup", `seasons/${DRAFT}/lineups/current`, { rows: [] }],
  ]) {
    await draft();
    await importRoster();
    await admin.doc(path).set(data); // e.g. an Admin SDK tool; rules forbid it from the app
    await assert.rejects(del(), (e) => e.name === "DraftNotDeletableError", label);
    const s = await getData(`seasons/${DRAFT}`);
    assert.equal(s.status, "draft", `${label}: lock cancelled`);
    assert.deepEqual(s.lifecycleHistory.map((e) => e.action), ["deletionStarted", "deletionCancelled"]);
    assert.equal((await players(DRAFT)).length, 2, `${label}: roster intact`);
    await admin.recursiveDelete(admin.doc(`seasons/${DRAFT}`));
  }
  // Recorded stats or awards on a draft roster entry also block.
  await draft();
  await importRoster();
  await updateDoc(doc(db, "seasons", DRAFT, "players", PS_IDS.alex), { "stats.hits": 2 });
  await assert.rejects(del(), /recorded stats or awards/);
  assert.equal((await getData(`seasons/${DRAFT}`)).status, "draft");
});

test("season-doc awards, layouts, or records block deletion in the app and in the rules", async () => {
  for (const patch of [
    { recognitionLayouts: { p1: { order: ["a"] } } },
    { finalAwards: { mvp: "p1" } },
    { endSeasonMode: true },
    { gamesPlayed: 1 },
    { record: { wins: 1, losses: 0, ties: 0 } },
  ]) {
    await draft();
    await updateDoc(doc(db, "seasons", DRAFT), patch); // ordinary edit on an open draft
    await assert.rejects(del(), (e) => e.name === "DraftNotDeletableError", JSON.stringify(patch));
    // Forging the lock directly is rejected too.
    const s = await getData(`seasons/${DRAFT}`);
    await expectDenied(updateDoc(doc(db, "seasons", DRAFT), { status: "deleting", lifecycleHistory: [...(s.lifecycleHistory ?? []), { action: "deletionStarted", at: "t", byUid: COACH_UID }] }));
    assert.equal((await getData(`seasons/${DRAFT}`)).status, "draft");
    await admin.recursiveDelete(admin.doc(`seasons/${DRAFT}`));
  }
});

test("active, finalized, legacy, and current seasons are protected (app and rules)", async () => {
  await draft();
  await makeCurrentSeason({ db, seasonId: DRAFT, uid: COACH_UID }); // active + current
  await draft("tigers-summer-2027", "Summer 2027");
  await admin.doc("app/config").set({ currentSeasonId: "tigers-summer-2027" }, { merge: true }); // inconsistent: a current draft
  await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING });

  for (const [id, why] of [[DRAFT, /draft/], [SPRING, /Finalized/], [FALL, /before drafts/], ["tigers-summer-2027", /current season/]]) {
    await assert.rejects(del(id), why, id);
    await expectDenied(deleteDoc(doc(db, "seasons", id)));
    const s = await getData(`seasons/${id}`);
    await expectDenied(updateDoc(doc(db, "seasons", id), { status: "deleting", lifecycleHistory: [...(s.lifecycleHistory ?? []), { action: "deletionStarted", at: "t", byUid: COACH_UID }] }));
    assert.ok(await exists(`seasons/${id}`), id);
  }
});

test("before the fix, the live rules let the coach delete any non-finalized season directly", async () => {
  await loadRules(LIVE_RULES);
  await deleteDoc(doc(db, "seasons", FALL)); // legacy current season: allowed under the 2026-10-23 rules
  assert.equal(await exists(`seasons/${FALL}`), false);
});

test("while locked, the season is frozen: no activation, current, edits, new players, or records", async () => {
  await draft();
  await importRoster();
  const D = doc(db, "seasons", DRAFT);
  const s = await getData(`seasons/${DRAFT}`);
  await updateDoc(D, { status: "deleting", lifecycleHistory: [...(s.lifecycleHistory ?? []), { action: "deletionStarted", at: "t", byUid: COACH_UID }] });

  await assert.rejects(makeCurrentSeason({ db, seasonId: DRAFT, uid: COACH_UID }));
  await expectDenied(setDoc(doc(db, "app", "config"), { currentSeasonId: DRAFT }, { merge: true }));
  await expectDenied(updateDoc(D, { seasonLabel: "Renamed" }));
  await expectDenied(updateDoc(D, { status: "finalized", finalizedByUid: COACH_UID, lifecycleHistory: [...(await getData(`seasons/${DRAFT}`)).lifecycleHistory, { action: "finalized", at: "t", byUid: COACH_UID }] }));
  await expectDenied(updateDoc(D, { status: "active", lifecycleHistory: [...(await getData(`seasons/${DRAFT}`)).lifecycleHistory, { action: "deletionCancelled", at: "t", byUid: COACH_UID }] }));
  await expectDenied(setDoc(doc(db, "seasons", DRAFT, "players", "late"), { name: "Late", number: 9, stats: {} }));
  await expectDenied(updateDoc(doc(db, "seasons", DRAFT, "players", PS_IDS.alex), { number: 99 }));
  await expectDenied(setDoc(doc(db, "seasons", DRAFT, "games", "g"), { date: "x" }));

  // An interrupted deletion resumes.
  assert.deepEqual(await del(), { outcome: "deleted", removedPlayers: 2 });
  assert.equal(await exists(`seasons/${DRAFT}`), false);
});

test("concurrent activation and deletion: exactly one wins, never a half-state", async () => {
  for (let i = 0; i < 4; i++) {
    await draft();
    await importRoster();
    const [act, rm] = await Promise.allSettled([
      makeCurrentSeason({ db, seasonId: DRAFT, uid: COACH_UID }),
      del(DRAFT, clientDb(COACH_UID)),
    ]);
    const cfg = (await getData("app/config")).currentSeasonId;
    if (rm.status === "fulfilled" && rm.value.outcome === "deleted") {
      assert.equal(act.status, "rejected", "activation lost");
      assert.equal(await exists(`seasons/${DRAFT}`), false);
      assert.deepEqual(await players(DRAFT), []);
      assert.equal(cfg, FALL);
    } else {
      assert.equal(act.status, "fulfilled", "deletion lost");
      assert.equal((await getData(`seasons/${DRAFT}`)).status, "active");
      assert.equal((await players(DRAFT)).length, 2);
      assert.equal(cfg, DRAFT);
      await admin.doc("app/config").set({ currentSeasonId: FALL }, { merge: true });
    }
    await admin.recursiveDelete(admin.doc(`seasons/${DRAFT}`));
  }
});

test("repeated and concurrent deletion requests are harmless", async () => {
  await draft();
  await importRoster();
  const before = await everythingElse();
  const results = await Promise.all([del(DRAFT), del(DRAFT, clientDb(COACH_UID))]);
  assert.ok(results.some((r) => r.outcome === "deleted"), JSON.stringify(results));
  assert.ok(results.every((r) => r.outcome === "deleted" || r.outcome === "alreadyDeleted"));
  assert.deepEqual(await del(), { outcome: "alreadyDeleted", removedPlayers: 0 });
  assert.equal(await exists(`seasons/${DRAFT}`), false);
  assert.equal(await everythingElse(), before);
});

test("only the head coach can lock, cancel, or delete a draft", async () => {
  await draft();
  await importRoster();
  const s = await getData(`seasons/${DRAFT}`);
  const lock = { status: "deleting", lifecycleHistory: [...(s.lifecycleHistory ?? []), { action: "deletionStarted", at: "t", byUid: "intruder" }] };
  for (const other of [clientDb("parent-not-admin"), clientDb(null)]) {
    await assert.rejects(deleteDraftSeason({ db: other, uid: "intruder", seasonId: DRAFT }));
    await expectDenied(updateDoc(doc(other, "seasons", DRAFT), lock));
    await expectDenied(deleteDoc(doc(other, "seasons", DRAFT, "players", PS_IDS.alex)));
    await expectDenied(deleteDoc(doc(other, "seasons", DRAFT)));
    await expectDenied(deleteDoc(doc(other, "playerIdentities", PS_IDS.alex)));
  }
  // The coach cannot forge someone else's audit entry either.
  await expectDenied(updateDoc(doc(db, "seasons", DRAFT), lock));
  assert.equal((await getData(`seasons/${DRAFT}`)).status, "draft");
  assert.equal((await players(DRAFT)).length, 2);
  // Unrelated runTransaction misuse: deleting the season doc without a lock.
  await expectDenied(runTransaction(db, async (tx) => tx.delete(doc(db, "seasons", DRAFT))));
});
