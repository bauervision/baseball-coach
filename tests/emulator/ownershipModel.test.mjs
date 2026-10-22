// Coach-owned player model through the real admin actions and rules:
// leaving a roster keeps history; deselecting a linked child keeps the link.
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { admin, clearFirestore, clientDb, closeClients, getData, seed } from "./support.mjs";
import {
  addPlayersToRoster,
  createSeason,
} from "../../src/app/(protected)/admin/_parts/adminActions.ts";
import {
  ensureManagedIdentity,
  linkExistingChild,
  listLinkedPlayers,
  listManagedIdentities,
} from "../../src/lib/coachPlayersStore.ts";
import { loadCareerSummary } from "../../src/lib/playerCareerStats.ts";
import { statsDigest } from "../../tools/identity/audit.mjs";
import { loadSnapshot, toJson } from "../../tools/identity/firestore.mjs";
import { COACH_UID, IDS, OTHER_COACH_UID, legacySnapshot } from "../support/fixtures.mjs";

const FALL = "tigers-fall-2026";
const NEXT = "broncos-spring-2027";

let db;
beforeEach(async () => {
  await clearFirestore();
  await seed(legacySnapshot(), [COACH_UID, OTHER_COACH_UID]);
  db = clientDb(COACH_UID);
});
after(closeClients);

test("leaving the team and deselecting a linked child change no history or links", async () => {
  // Cole is the coach's own child.
  await ensureManagedIdentity({ db, uid: COACH_UID, careerPlayerId: IDS.cole, displayName: "Cole Evans" });
  await linkExistingChild({ db, uid: COACH_UID, careerPlayerId: IDS.cole, displayName: "Cole Evans" });

  const before = toJson(await loadSnapshot(admin));
  const fallFinnBefore = await getData(`seasons/${FALL}/players/11-finn-hale`);

  // New team; the coach brings back only Ava. Finn has left; Cole was
  // preselected but the coach deselected him this season.
  await createSeason({
    db,
    uid: COACH_UID,
    seasonId: NEXT,
    existingSeasonIds: [],
    teamName: "Broncos",
    teamId: "broncos",
    seasonLabel: "Spring 2027",
    usesGamesPlayedRecord: false,
    scheduledGames: 10,
    fallbackTeamName: "Team",
  });
  await addPlayersToRoster({
    db,
    seasonId: NEXT,
    imports: [
      {
        careerPlayerId: IDS.ava,
        name: "Ava Carter",
        linkedFrom: [{ seasonId: FALL, seasonPlayerId: "07-ava-carter" }],
        number: "7",
        primaryPos: "",
        shirtSize: "",
      },
    ],
    newPlayers: [],
  });

  const roster = (await admin.collection(`seasons/${NEXT}/players`).get()).docs.map((d) => d.id);
  assert.deepEqual(roster, [IDS.ava], "neither Finn nor Cole enrolled");

  // Prior seasons, games, and lines are byte-for-byte unchanged.
  const afterSnap = toJson(await loadSnapshot(admin));
  afterSnap.seasons = afterSnap.seasons.filter((s) => s.seasonId !== NEXT);
  assert.equal(statsDigest(afterSnap), statsDigest(before));
  assert.deepEqual(await getData(`seasons/${FALL}/players/11-finn-hale`), fallFinnBefore);
  assert.equal((await getData(`seasons/${FALL}`)).finalAwards.mvp, "09-dana-fox");

  // Finn's career, seen publicly, is still his Fall season.
  const finn = { id: "11-finn-hale", ...fallFinnBefore };
  const career = await loadCareerSummary({
    db: clientDb(null),
    seasonId: FALL,
    player: finn,
    currentSeason: { teamName: "Tigers", seasonLabel: "Fall 2026" },
  });
  assert.equal(career.history.length, 1);
  assert.equal(career.totals.hits, 6);

  // Cole is still the coach's linked child and managed identity.
  assert.deepEqual((await listLinkedPlayers(db, COACH_UID)).map((l) => l.careerPlayerId), [IDS.cole]);
  assert.ok(await getData(`playerIdentities/${IDS.cole}`));
});

test("another coach cannot discover or take over this coach's players", async () => {
  await ensureManagedIdentity({ db, uid: COACH_UID, careerPlayerId: IDS.finn, displayName: "Finn Hale" });
  const other = clientDb(OTHER_COACH_UID);
  assert.deepEqual(await listManagedIdentities(other, OTHER_COACH_UID), []);
  assert.equal(
    await ensureManagedIdentity({ db: other, uid: OTHER_COACH_UID, careerPlayerId: IDS.finn, displayName: "Finn" }),
    false,
  );
  assert.deepEqual((await getData(`playerIdentities/${IDS.finn}`)).managerUids, [COACH_UID]);
});
