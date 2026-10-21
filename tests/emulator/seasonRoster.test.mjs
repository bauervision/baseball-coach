// Season and roster safeguards, run through the real admin actions against
// the emulator as an allowlisted coach (rules enforced).
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  admin,
  clearFirestore,
  clientDb,
  closeClients,
  getData,
  seed,
} from "./support.mjs";
import {
  addPlayersToRoster,
  createSeason,
  makeCurrentSeason,
  removeRosterPlayer,
  saveGameAndApplyDeltas,
  savePlayerEdits,
} from "../../src/app/(protected)/admin/_parts/adminActions.ts";
import { loadCareerSummary } from "../../src/lib/playerCareerStats.ts";
import { EMPTY_COACH_PICKS, EMPTY_DELTA } from "../../src/app/(protected)/admin/adminHelpers.ts";
import { COACH_UID, IDS, legacySnapshot } from "../support/fixtures.mjs";
import { statsDigest } from "../../tools/identity/audit.mjs";
import { loadSnapshot, toJson } from "../../tools/identity/firestore.mjs";

let db;
beforeEach(async () => {
  await clearFirestore();
  await seed(legacySnapshot(), [COACH_UID]);
  db = clientDb(COACH_UID);
});
after(closeClients);

const FALL = "tigers-fall-2026";
const SPRING = "tigers-2026";
const NEXT = "broncos-spring-2027";

async function seasonPlayers(seasonId) {
  const snap = await admin.collection(`seasons/${seasonId}/players`).get();
  return new Map(snap.docs.map((d) => [d.id, d.data()]));
}

async function createNext(overrides = {}) {
  return createSeason({
    db,
    uid: COACH_UID,
    seasonId: NEXT,
    existingSeasonIds: [SPRING, FALL],
    teamName: "Broncos",
    teamId: "broncos",
    seasonLabel: "Spring 2027",
    usesGamesPlayedRecord: false,
    scheduledGames: 10,
    fallbackTeamName: "Team",
    ...overrides,
  });
}

/** Digest of every season's stats and game lines except the new one. */
async function historyDigest() {
  const snap = toJson(await loadSnapshot(admin));
  snap.seasons = snap.seasons.filter((s) => s.seasonId !== NEXT);
  return statsDigest(snap);
}

function asPlayers(map) {
  return [...map].map(([id, d]) => ({ id, ...d }));
}

test("creating a season with an existing id never resets it", async () => {
  const before = await getData(`seasons/${FALL}`);
  // Even when the UI's season list is stale, the transaction refuses.
  await assert.rejects(
    createSeason({
      db,
      uid: COACH_UID,
      seasonId: FALL,
      existingSeasonIds: [],
      teamName: "Tigers",
      teamId: "",
      seasonLabel: "Fall 2026",
      usesGamesPlayedRecord: false,
      scheduledGames: 0,
      fallbackTeamName: "Team",
    }),
    /already exists/,
  );
  const afterData = await getData(`seasons/${FALL}`);
  assert.deepEqual(afterData, before);
  assert.deepEqual(afterData.record, { wins: 5, losses: 3, ties: 1 });
  assert.equal(afterData.gamesPlayed, 9);
});

test("create season does not switch seasons; make current changes only app/config", async () => {
  await createNext();
  assert.equal((await getData("app/config")).currentSeasonId, FALL);
  const created = await getData(`seasons/${NEXT}`);
  assert.equal(created.teamId, "broncos");
  assert.deepEqual(created.coachUids, [COACH_UID]);
  assert.deepEqual(created.record, { wins: 0, losses: 0, ties: 0 });

  const fallBefore = await getData(`seasons/${FALL}`);
  await makeCurrentSeason({ db, seasonId: NEXT });
  assert.equal((await getData("app/config")).currentSeasonId, NEXT);
  await makeCurrentSeason({ db, seasonId: FALL });
  assert.equal((await getData("app/config")).currentSeasonId, FALL);
  assert.deepEqual(await getData(`seasons/${FALL}`), fallBefore, "switching back changes nothing");

  await assert.rejects(makeCurrentSeason({ db, seasonId: "nope-2030" }), /does not exist/);
});

test("returning-player import is additive, idempotent, and leaves history untouched", async () => {
  await createNext();
  const historyBefore = await historyDigest();
  const fallRosterBefore = await seasonPlayers(FALL);

  const imports = [
    ["ava", "07-ava-carter", "Ava Carter", "17"],
    ["ben", "21-ben-diaz", "Ben Diaz", "2"],
    ["cole", "03-cole-evans", "Cole Evans", "3"],
    ["dana", "09-dana-fox", "Dana Fox", "99"],
  ].map(([key, fallId, name, number]) => ({
    careerPlayerId: IDS[key],
    name,
    linkedFrom: [{ seasonId: FALL, seasonPlayerId: fallId }],
    number,
    primaryPos: "",
    shirtSize: "YL",
  }));
  const newPlayers = [
    { careerPlayerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Kai New", number: "8", primaryPos: "", shirtSize: "" },
  ];

  const first = await addPlayersToRoster({ db, seasonId: NEXT, imports, newPlayers });
  assert.equal(first.writes.length, 5);
  const second = await addPlayersToRoster({ db, seasonId: NEXT, imports, newPlayers });
  assert.equal(second.writes.length, 0, "repeat submission adds nothing");
  assert.equal(second.skipped.length, 5);

  const roster = await seasonPlayers(NEXT);
  assert.equal(roster.size, 5);
  assert.equal(roster.get(IDS.ben).number, 2, "new jersey number");
  for (const p of roster.values()) {
    assert.ok(Object.values(p.stats).every((v) => v === 0), "season totals start at zero");
    assert.equal(p.identityStatus, "confirmed");
  }

  assert.equal(await historyDigest(), historyBefore);
  assert.deepEqual(await seasonPlayers(FALL), fallRosterBefore, "previous roster not mutated");
});

test("career follows the permanent id across teams; new season does not erase it", async () => {
  await createNext();
  await addPlayersToRoster({
    db,
    seasonId: NEXT,
    imports: [
      {
        careerPlayerId: IDS.ava,
        name: "Ava Carter",
        linkedFrom: [{ seasonId: FALL, seasonPlayerId: "07-ava-carter" }],
        number: "17",
        primaryPos: "",
        shirtSize: "",
      },
    ],
    newPlayers: [],
  });

  const p = (await seasonPlayers(NEXT)).get(IDS.ava);
  const player = { id: IDS.ava, ...p };
  const anon = clientDb(null); // career is visible on the public player page
  const career = await loadCareerSummary({
    db: anon,
    seasonId: NEXT,
    player,
    currentSeason: { teamName: "Broncos", seasonLabel: "Spring 2027" },
  });
  // Spring 2026 shares Ava's id only through legacy name matching: excluded.
  assert.deepEqual(career.history.map((h) => `${h.teamName} ${h.seasonLabel}`), [
    "Tigers Fall 2026",
    "Broncos Spring 2027",
  ]);
  assert.equal(career.totals.hits, 11);

  // Coach approves the Spring link (what identity-migrate writes).
  await admin.doc(`seasons/${SPRING}/players/07-ava-carter`).set({ identityStatus: "confirmed" }, { merge: true });
  await admin.doc(`seasons/${FALL}/players/07-ava-carter`).set({ identityStatus: "confirmed" }, { merge: true });
  const full = await loadCareerSummary({
    db: anon,
    seasonId: NEXT,
    player,
    currentSeason: { teamName: "Broncos", seasonLabel: "Spring 2027" },
  });
  assert.equal(full.history.length, 3);
  assert.equal(full.totals.hits, 9 + 11);

  // Same-name different child is never pulled in.
  const jordan = (await seasonPlayers(FALL)).get("10-jordan-kim");
  const jCareer = await loadCareerSummary({
    db: anon,
    seasonId: FALL,
    player: { id: "10-jordan-kim", ...jordan },
    currentSeason: { teamName: "Tigers", seasonLabel: "Fall 2026" },
  });
  assert.equal(jCareer.history.length, 1);
});

test("editing name/number keeps identity and game lines; stats rebuild unchanged", async () => {
  const fall = await seasonPlayers(FALL);
  const players = asPlayers(fall);
  const ben = fall.get("21-ben-diaz");

  await savePlayerEdits({
    db,
    seasonId: FALL,
    players,
    edits: {
      "21-ben-diaz": {
        name: "Benjamin Diaz",
        number: "44",
        shirtSize: "YM",
        leaderboardHidden: false,
        returningPlayer: true,
        dirty: true,
      },
    },
  });
  const edited = await getData(`seasons/${FALL}/players/21-ben-diaz`);
  assert.equal(edited.careerPlayerId, ben.careerPlayerId, "identity preserved");
  assert.equal(edited.number, 44);
  assert.equal(await getData(`seasons/${FALL}/players/44-benjamin-diaz`), null, "doc id unchanged");

  // Saving another game rebuilds totals from all lines, including the
  // historical one recorded under the old number.
  const lines = Object.fromEntries(
    players.map((p) => [p.id, { hidden: true, delta: { ...EMPTY_DELTA } }]),
  );
  lines["21-ben-diaz"] = { hidden: false, delta: { ...EMPTY_DELTA, atBats: 2, hits: 1 } };
  await saveGameAndApplyDeltas({
    db,
    seasonId: FALL,
    date: "2026-09-20",
    opponent: "Hawks",
    result: "W",
    gameType: "regular",
    scoreUs: "5",
    scoreThem: "3",
    players: asPlayers(await seasonPlayers(FALL)),
    lines,
    coachPicks: { ...EMPTY_COACH_PICKS },
    gameBallPlayerId: "",
  });
  const rebuilt = await getData(`seasons/${FALL}/players/21-ben-diaz`);
  assert.equal(rebuilt.stats.hits, 2 + 1, "old line (#21) + new line (#44)");
  assert.equal(rebuilt.careerPlayerId, ben.careerPlayerId);
});

test("removal needs typed confirmation and is refused for players with history", async () => {
  await assert.rejects(
    removeRosterPlayer({ db, seasonId: FALL, seasonPlayerId: "07-ava-carter", confirmName: "ava" }),
    /exactly/,
  );
  await assert.rejects(
    removeRosterPlayer({ db, seasonId: FALL, seasonPlayerId: "07-ava-carter", confirmName: "Ava Carter" }),
    /has game stats/,
  );
  await assert.rejects(
    removeRosterPlayer({ db, seasonId: FALL, seasonPlayerId: "09-dana-fox", confirmName: "Dana Fox" }),
    /recognition|award/,
  );
  assert.ok(await getData(`seasons/${FALL}/players/07-ava-carter`));

  // A player added by mistake (no history) can be removed.
  await createNext();
  await addPlayersToRoster({
    db,
    seasonId: NEXT,
    imports: [],
    newPlayers: [{ careerPlayerId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Oops Player", number: "", primaryPos: "", shirtSize: "" }],
  });
  await removeRosterPlayer({
    db,
    seasonId: NEXT,
    seasonPlayerId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    confirmName: "Oops Player",
  });
  assert.equal((await seasonPlayers(NEXT)).size, 0);
});

test("a prior entry linked from a later season cannot be removed", async () => {
  await createNext();
  await addPlayersToRoster({
    db,
    seasonId: NEXT,
    imports: [
      {
        careerPlayerId: IDS.finn,
        name: "Finn Hale",
        linkedFrom: [{ seasonId: FALL, seasonPlayerId: "11-finn-hale" }],
        number: "",
        primaryPos: "",
        shirtSize: "",
      },
    ],
    newPlayers: [],
  });
  await assert.rejects(
    removeRosterPlayer({ db, seasonId: FALL, seasonPlayerId: "11-finn-hale", confirmName: "Finn Hale" }),
    /linked from a later season/,
  );
});
