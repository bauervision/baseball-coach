// Release compatibility on production-shaped data (emulator only).
//
// Production runs the 2026-08-16 rules and the 2026-10-21 app (v1.3.0).
// Release order is rules → app, so for a while the OLD app writes under
// the NEW rules, and old and new app versions may share the database.
// These tests pin down every direction:
//   1. old-app write patterns are accepted by the proposed rules;
//   2. the new app under the deployed rules: team writes fail (the
//      observed bug) and lifecycle is NOT enforced — why rules go first;
//   3. the new app's full workflow under the proposed rules;
//   4. the approved identity migration's effect on careers.
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FieldPath, deleteField, doc, getDoc, setDoc, updateDoc, writeBatch } from "firebase/firestore";

import { PROJECT_ID, admin, clearFirestore, clientDb, closeClients, expectDenied, getData, seed } from "./support.mjs";
import {
  addPlayersToRoster,
  createSeasonOrResume,
  finalizeSeason,
  makeCurrentSeason,
  reopenSeason,
  saveGameAndApplyDeltas,
  savePlayerEdits,
} from "../../src/app/(protected)/admin/_parts/adminActions.ts";
import { EMPTY_COACH_PICKS, EMPTY_DELTA } from "../../src/app/(protected)/admin/adminHelpers.ts";
import { createTeamIdempotent, listTeams, updateTeam } from "../../src/lib/teamStore.ts";
import { listSeasons } from "../../src/lib/seasonStore.ts";
import { loadCareerSummary } from "../../src/lib/playerCareerStats.ts";
import { saveRecognitionLayout } from "../../src/lib/recognitionLayoutStore.ts";
import { LEGACY_TIGERS_BRANDING, snapshotFromTeam } from "../../src/lib/branding.ts";
import { planMigration } from "../../tools/identity/audit.mjs";
import { loadSnapshot, toJson } from "../../tools/identity/firestore.mjs";
import { COACH_UID } from "../support/fixtures.mjs";
import { PS_IDS, productionShapedApprovals, productionShapedSnapshot } from "../support/productionShapedFixture.mjs";

const REPO_RULES = fs.readFileSync("firestore.rules", "utf8");
const DEPLOYED_RULES = fs.readFileSync("tests/support/deployed-2026-08-16.firestore.rules", "utf8");
const SPRING = "tigers-2026";
const FALL = "tigers-fall-2026";

async function loadRules(content) {
  const res = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}:securityRules`,
    { method: "PUT", body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }) },
  );
  if (!res.ok) throw new Error(`rules load failed: ${res.status}`);
}

let db;
beforeEach(async () => {
  await clearFirestore();
  await seed(productionShapedSnapshot(), [COACH_UID]);
  db = clientDb(COACH_UID);
});
after(async () => {
  await loadRules(REPO_RULES);
  await closeClients();
});

const getDocFrom = (d, path) => getDoc(doc(d, path));
const roster = async (sid) => (await admin.collection(`seasons/${sid}/players`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const lines = (ps) => Object.fromEntries(ps.slice(0, 3).map((p) => [p.id, { hidden: false, delta: { ...EMPTY_DELTA, atBats: 3, hits: 1 } }]));

test("proposed rules accept the deployed app's (v1.3.0) write patterns on legacy seasons", async () => {
  // Same calls, fields, and merge modes as src at 2f129d2 (live since 2026-10-21).
  const S = (id, ...p) => doc(db, "seasons", id, ...p);
  await setDoc(S(SPRING), { teamName: "Tigers", seasonLabel: "Spring 2026", league: "Mustang", usesGamesPlayedRecord: false, scheduledGames: 12, updatedAt: new Date() }, { merge: true }); // switchSeason
  await setDoc(doc(db, "app", "config"), { currentSeasonId: FALL, updatedAt: new Date() }, { merge: true });
  await setDoc(S(FALL), { scheduledGames: 10, updatedAt: new Date() }, { merge: true }); // updateScheduledGames
  await setDoc(S(FALL, "players", "21-alex-rivera"), { name: "Alex Rivera", number: "21", shirtSize: "YM", updatedAt: new Date() }, { merge: true }); // savePlayerEdits
  const b = writeBatch(db); // saveGameAndApplyDeltas
  b.set(S(FALL, "games", "20261024-compat-1"), { date: "2026-10-24", opponent: "Compat", result: "W", score: { us: 5, them: 3 }, updatedAt: new Date() }, { merge: true });
  b.set(S(FALL, "games", "20261024-compat-1", "lines", "21-alex-rivera"), { playerId: "21-alex-rivera", name: "Alex Rivera", number: 21, delta: { ...EMPTY_DELTA, hits: 1 } }, { merge: true });
  b.set(S(FALL, "players", "21-alex-rivera"), { stats: { hits: 99 } }, { merge: true });
  b.set(S(FALL), { record: { wins: 4, losses: 5, ties: 2 }, gamesPlayed: 11 }, { merge: true });
  await b.commit();
  await updateDoc(S(FALL), new FieldPath("recognitionLayouts", "21-alex-rivera"), { order: ["a"], updatedAt: new Date() });
  await updateDoc(S(FALL), new FieldPath("recognitionLayouts", "21-alex-rivera"), deleteField());
  await setDoc(S(FALL, "lineups", "current"), { id: "current", seasonId: FALL, rows: [], updatedAt: new Date() }, { merge: true });
  await setDoc(S(FALL), { endSeasonMode: true, finalAwards: { mvp: "21-alex-rivera" } }, { merge: true });
  // Roster rebuild on a season the old app creates: delete + set(merge:false).
  await setDoc(S("tigers-spring-2027"), { teamName: "Tigers", seasonLabel: "Spring 2027", createdAt: new Date() }, { merge: true });
  await setDoc(S("tigers-spring-2027", "players", "01-new"), { name: "New", number: "1", stats: {} }, { merge: false });
  await setDoc(S("tigers-spring-2027"), { record: { wins: 0, losses: 0, ties: 0 } }, { merge: true });

  // A season the new app finalized stays read-only to the old app.
  await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING });
  await expectDenied(setDoc(S(SPRING), { teamName: "Tigers", seasonLabel: "Spring 2026" }, { merge: true }));
  await expectDenied(setDoc(S(SPRING, "players", "p01"), { shirtSize: "YL" }, { merge: true }));
});

test("deployed rules: the new app's teams fail (the observed bug) and lifecycle is not enforced", async () => {
  await loadRules(DEPLOYED_RULES);
  try {
    await expectDenied(listTeams(db));
    await expectDenied(createTeamIdempotent(db, { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "tigers-0001" }));
    // Legacy features keep working with the new app before the rules deploy.
    assert.deepEqual((await listSeasons(db)).map((s) => s.seasonId).sort(), [SPRING, FALL]);
    const ps = await roster(FALL);
    await saveGameAndApplyDeltas({ db, seasonId: FALL, date: "2026-10-24", opponent: "Compat", result: "W", gameType: "regular", scoreUs: "4", scoreThem: "2", players: ps, lines: lines(ps), coachPicks: { ...EMPTY_COACH_PICKS }, gameBallPlayerId: "" });
    // ...but a "finalized" season is still writable: lifecycle needs the new rules first.
    await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING });
    await setDoc(doc(db, "seasons", SPRING, "players", "p01"), { shirtSize: "YL" }, { merge: true });
    assert.equal((await getData(`seasons/${SPRING}/players/p01`)).shirtSize, "YL", "not enforced under deployed rules");
  } finally {
    await loadRules(REPO_RULES);
  }
});

test("proposed rules: legacy seasons read correctly and the new workflow runs end to end", async () => {
  const springOf = async () => toJson(await loadSnapshot(admin)).seasons.find((s) => s.seasonId === SPRING);
  const springBefore = await springOf();
  const seasons = await listSeasons(db);
  const spring = seasons.find((s) => s.seasonId === SPRING);
  assert.deepEqual([spring.teamName, spring.seasonLabel, spring.status], ["Tigers", "Spring 2026", null], "legacy defaults, no status");
  assert.equal(seasons.find((s) => s.seasonId === FALL).seasonLabel, "Fall 2026");

  // Current-season stat entry and player edits on the legacy current season.
  const ps = await roster(FALL);
  const { gameId } = await saveGameAndApplyDeltas({ db, seasonId: FALL, date: "2026-10-24", opponent: "Compat", result: "W", gameType: "regular", scoreUs: "4", scoreThem: "2", players: ps, lines: lines(ps), coachPicks: { ...EMPTY_COACH_PICKS }, gameBallPlayerId: ps[0].id });
  assert.ok((await getData(`seasons/${FALL}/games/${gameId}`)).gameType === "regular");
  await savePlayerEdits({ db, seasonId: FALL, players: ps, edits: { [ps[1].id]: { name: ps[1].name, number: String(ps[1].number), shirtSize: "YL", leaderboardHidden: false, returningPlayer: true, dirty: true } } });
  await saveRecognitionLayout({ db, seasonId: FALL, playerId: ps[0].id, order: ["hits"] });

  // Team Designer: baseball + softball teams, both palettes, edit.
  const tigers = { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "tigers-0001" };
  await createTeamIdempotent(db, tigers);
  const falcons = { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "falcons-0001", teamName: "Falcons", shortName: "FAL", sport: "softball", logo: null };
  falcons.palettes.dark.primary = "#2563eb";
  falcons.palettes.light.primary = "#1d4ed8";
  await createTeamIdempotent(db, falcons);
  await updateTeam(db, { ...falcons, division: "10U" });
  assert.deepEqual((await listTeams(db)).map((t) => [t.teamId, t.sport]), [["falcons-0001", "softball"], ["tigers-0001", "baseball"]]);

  // Guided setup: draft with snapshot, returning + new players, explicit activation.
  await createSeasonOrResume({ db, uid: COACH_UID, team: tigers, seasonId: "tigers-spring-2027", seasonLabel: "Spring 2027", scheduledGames: 12, existingSeasonIds: [SPRING, FALL] });
  const draft = await getData("seasons/tigers-spring-2027");
  assert.equal(draft.status, "draft");
  assert.deepEqual(draft.branding, snapshotFromTeam(tigers));
  assert.equal((await getData("app/config")).currentSeasonId, FALL, "draft is not current");
  const alex = ps.find((p) => p.id === "21-alex-rivera");
  await addPlayersToRoster({
    db, seasonId: "tigers-spring-2027",
    imports: [{ careerPlayerId: alex.careerPlayerId, name: alex.name, number: "21", primaryPos: "", shirtSize: "", linkedFrom: [{ seasonId: FALL, seasonPlayerId: alex.id }] }],
    newPlayers: [{ careerPlayerId: "eeeeeeee-0000-4000-8000-00000000000e", name: "Tess Kerr", number: "8", primaryPos: "", shirtSize: "" }],
  });
  await makeCurrentSeason({ db, seasonId: "tigers-spring-2027", uid: COACH_UID });
  assert.equal((await getData("app/config")).currentSeasonId, "tigers-spring-2027");
  assert.equal((await getData("seasons/tigers-spring-2027")).status, "active");

  // Finalize Spring 2026, writes blocked, reopen restores editing.
  await finalizeSeason({ db, uid: COACH_UID, seasonId: SPRING });
  await expectDenied(setDoc(doc(db, "seasons", SPRING, "players", "p01"), { shirtSize: "YL" }, { merge: true }));
  await reopenSeason({ db, uid: COACH_UID, seasonId: SPRING });
  assert.equal((await getData(`seasons/${SPRING}`)).status, "active");

  // Historical game data, stats, awards, and lineups unchanged by all of the
  // above except the explicit edits on Fall 2026 and the lifecycle fields.
  const springNow = await springOf();
  assert.deepEqual(springNow.players, springBefore.players, "Spring roster and stats untouched");
  assert.deepEqual(springNow.games, springBefore.games, "Spring games and lines untouched");
  assert.deepEqual(springNow.lineups, springBefore.lineups, "Spring lineup untouched");
  for (const k of ["record", "record.wins", "record.losses", "finalAwards", "league", "endSeasonMode"]) {
    assert.deepEqual(springNow.data[k], springBefore.data[k], `Spring ${k} untouched`);
  }
});

test("public reads are no broader than the deployed rules", async () => {
  const anon = clientDb(null);
  const parent = clientDb("parent-not-admin");
  await admin.doc(`seasons/${FALL}/notes/n1`).set({ private: true });
  await admin.doc("teams/tigers-0001").set({ ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "tigers-0001" });
  for (const [rules, label] of [[DEPLOYED_RULES, "deployed"], [REPO_RULES, "proposed"]]) {
    await loadRules(rules);
    try {
      // Same public surface: config, seasons, players, games, lines, lineups.
      for (const path of ["app/config", `seasons/${FALL}`, `seasons/${FALL}/players/21-alex-rivera`, `seasons/${FALL}/lineups/current`]) {
        assert.ok((await getDocFrom(anon, path)).exists(), `${label}: ${path} public`);
      }
      // Nothing else: unknown season subcollections, teams, identities, admins.
      for (const d of [anon, parent]) {
        await expectDenied(getDocFrom(d, `seasons/${FALL}/notes/n1`));
        await expectDenied(getDocFrom(d, "teams/tigers-0001"));
        await expectDenied(getDocFrom(d, `admins/${COACH_UID}`));
      }
    } finally {
      await loadRules(REPO_RULES);
    }
  }
  assert.ok((await getDocFrom(db, `seasons/${FALL}/notes/n1`)).exists(), "head coach can still read them");
});

test("the approved identity migration links exactly the four returning players' careers", async () => {
  const snap = toJson(await loadSnapshot(admin));
  const plan = planMigration(snap, { approvals: productionShapedApprovals() });
  assert.ok(plan.ok, plan.errors?.join("; "));
  assert.equal(plan.ops.length, 8, "4 Spring links + 4 Fall confirmations");
  assert.deepEqual(new Set(plan.ops.map((o) => o.set.careerPlayerId)), new Set(Object.values(PS_IDS)));

  const career = async () => {
    const blake = (await roster(FALL)).find((p) => p.id === "500-blake-turner");
    return loadCareerSummary({ db: clientDb(null), seasonId: FALL, player: blake, currentSeason: { teamName: "Tigers", seasonLabel: "Fall 2026" } });
  };
  assert.equal((await career()).history.length, 1, "before: Fall only");

  await seed(productionShapedSnapshot({ migrated: true }), [COACH_UID]);
  const linked = await career();
  assert.deepEqual(linked.history.map((h) => `${h.teamName} ${h.seasonLabel}`), ["Tigers Spring 2026", "Tigers Fall 2026"], "#999 → #500 linked by id, not name or number");
  const others = (await roster(SPRING)).filter((p) => p.careerPlayerId);
  assert.equal(others.length, 4, "no other Spring player gets an identity");
});
