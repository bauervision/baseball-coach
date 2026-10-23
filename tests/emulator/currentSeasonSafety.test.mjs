// Current-season safety (app/config.currentSeasonId) on the production-shaped
// fixture. Under the deployed rules a stale v1.3.0 browser could point the
// app at a draft or finalized season (its season switcher merge-writes the
// season labels and config in one batch). The proposed rules require the
// current season to exist and be eligible after the request: legacy or
// active, never draft or finalized. Legitimate old- and new-app switches
// keep working.
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deleteDoc, doc, setDoc, updateDoc, writeBatch } from "firebase/firestore";

import { PROJECT_ID, admin, clearFirestore, clientDb, closeClients, expectDenied, getData, seed } from "./support.mjs";
import {
  createSeasonOrResume,
  finalizeSeason,
  makeCurrentSeason,
  reopenSeason,
} from "../../src/app/(protected)/admin/_parts/adminActions.ts";
import { LEGACY_TIGERS_BRANDING } from "../../src/lib/branding.ts";
import { COACH_UID } from "../support/fixtures.mjs";
import { productionShapedSnapshot } from "../support/productionShapedFixture.mjs";

const REPO_RULES = fs.readFileSync("firestore.rules", "utf8");
const DEPLOYED_RULES = fs.readFileSync("tests/support/deployed-2026-08-16.firestore.rules", "utf8");
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
  await seed(productionShapedSnapshot(), [COACH_UID]);
  db = clientDb(COACH_UID);
  // A draft created by the new app (guided setup).
  await admin.doc(`teams/${TIGERS.teamId}`).set({ ...TIGERS, createdAt: new Date(), updatedAt: new Date() });
  await createSeasonOrResume({ db, uid: COACH_UID, team: TIGERS, seasonId: DRAFT, seasonLabel: "Spring 2027", scheduledGames: 12, existingSeasonIds: [SPRING, FALL] });
});
after(async () => {
  await loadRules(REPO_RULES);
  await closeClients();
});

const current = async () => (await getData("app/config")).currentSeasonId;

// The deployed app's season switcher (src at 2f129d2, switchSeason): one
// batch merging the target season's labels and app/config.
function oldAppSwitch(d, seasonId, labels = { teamName: "Tigers", seasonLabel: "Spring 2027" }) {
  const b = writeBatch(d);
  b.set(doc(d, "seasons", seasonId), { ...labels, league: "Mustang", usesGamesPlayedRecord: false, scheduledGames: 12, updatedAt: new Date() }, { merge: true });
  b.set(doc(d, "app", "config"), { currentSeasonId: seasonId, updatedAt: new Date() }, { merge: true });
  return b.commit();
}

test("before the fix: a stale old-app session could make a draft current without activation", async () => {
  await loadRules(DEPLOYED_RULES);
  await oldAppSwitch(db, DRAFT);
  assert.equal(await current(), DRAFT);
  assert.equal((await getData(`seasons/${DRAFT}`)).status, "draft", "current but never activated");
  // ...or point config at a missing season.
  await setDoc(doc(db, "app", "config"), { currentSeasonId: "no-such-season" }, { merge: true });
  assert.equal(await current(), "no-such-season");
});

test("after the fix: drafts, finalized, and missing seasons cannot become current by a direct write", async () => {
  const draftBefore = await getData(`seasons/${DRAFT}`);
  await expectDenied(oldAppSwitch(db, DRAFT, { teamName: "Renamed", seasonLabel: "Renamed" }));
  await expectDenied(setDoc(doc(db, "app", "config"), { currentSeasonId: DRAFT }, { merge: true }));
  await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING });
  await expectDenied(setDoc(doc(db, "app", "config"), { currentSeasonId: SPRING }, { merge: true }));
  await expectDenied(setDoc(doc(db, "app", "config"), { currentSeasonId: "no-such-season" }, { merge: true }));
  await expectDenied(setDoc(doc(db, "app", "config"), { currentSeasonId: "" }, { merge: true }));
  await expectDenied(setDoc(doc(db, "app", "config"), { currentSeasonId: 42 }, { merge: true }));
  await expectDenied(deleteDoc(doc(db, "app", "config")));
  // Draft labels written in the same rejected batch did not land either.
  assert.deepEqual(await getData(`seasons/${DRAFT}`), draftBefore);
  assert.equal(await current(), FALL);
});

test("old app: legitimate switches between legacy seasons, and creating one, still work", async () => {
  await oldAppSwitch(db, SPRING, { teamName: "Tigers", seasonLabel: "Spring 2026" });
  assert.equal(await current(), SPRING);
  await oldAppSwitch(db, FALL, { teamName: "Tigers", seasonLabel: "Fall 2026" });
  assert.equal(await current(), FALL);
  await oldAppSwitch(db, "tigers-summer-2027", { teamName: "Tigers", seasonLabel: "Summer 2027" }); // legacy-style create
  assert.equal(await current(), "tigers-summer-2027");
  // Same-id config rewrites always pass, even if the current season was finalized since.
  await oldAppSwitch(db, FALL, { teamName: "Tigers", seasonLabel: "Fall 2026" });
  await finalizeSeason({ db, uid: COACH_UID, seasonId: FALL });
  await setDoc(doc(db, "app", "config"), { currentSeasonId: FALL, updatedAt: new Date() }, { merge: true });
  assert.equal(await current(), FALL);
});

test("new app: activation obeys the lifecycle (draft activates, finalized refused until reopened)", async () => {
  await makeCurrentSeason({ db, seasonId: DRAFT, uid: COACH_UID });
  assert.equal(await current(), DRAFT);
  const s = await getData(`seasons/${DRAFT}`);
  assert.equal(s.status, "active");
  assert.deepEqual(s.lifecycleHistory.map((e) => [e.action, e.byUid]), [["activated", COACH_UID]]);

  await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING });
  await assert.rejects(makeCurrentSeason({ db, seasonId: SPRING, uid: COACH_UID }), /finalized/);
  await reopenSeason({ db, uid: COACH_UID, seasonId: SPRING });
  await makeCurrentSeason({ db, seasonId: SPRING, uid: COACH_UID });
  assert.equal(await current(), SPRING);
  await makeCurrentSeason({ db, seasonId: FALL, uid: COACH_UID }); // legacy, no activation needed
  assert.equal(await current(), FALL);
  assert.equal((await getData(`seasons/${FALL}`)).status, undefined, "legacy season untouched");
});

test("activation cannot be forged or skipped", async () => {
  const D = doc(db, "seasons", DRAFT);
  // Activation without an audit entry, or attributed to someone else.
  await expectDenied(updateDoc(D, { status: "active" }));
  await expectDenied(updateDoc(D, { status: "active", lifecycleHistory: [{ action: "activated", at: "t", byUid: "someone" }] }));
  // Activation and config together but with a forged entry: both rejected.
  const b = writeBatch(db);
  b.update(D, { status: "active", lifecycleHistory: [{ action: "activated", at: "t", byUid: "someone" }] });
  b.set(doc(db, "app", "config"), { currentSeasonId: DRAFT }, { merge: true });
  await expectDenied(b.commit());
  // Back to draft from active, or re-activating an active season.
  await makeCurrentSeason({ db, seasonId: DRAFT, uid: COACH_UID });
  await expectDenied(updateDoc(D, { status: "draft" }));
  await expectDenied(updateDoc(D, { status: "active", lifecycleHistory: [...(await getData(`seasons/${DRAFT}`)).lifecycleHistory, { action: "activated", at: "t", byUid: COACH_UID }] }));
  assert.equal((await getData(`seasons/${DRAFT}`)).lifecycleHistory.length, 1);
});

test("only the head coach can change the current season", async () => {
  for (const other of [clientDb("parent-not-admin"), clientDb(null)]) {
    await expectDenied(setDoc(doc(other, "app", "config"), { currentSeasonId: SPRING }, { merge: true }));
    await expectDenied(oldAppSwitch(other, SPRING, { teamName: "Tigers", seasonLabel: "Spring 2026" }));
  }
  assert.equal(await current(), FALL);
});
