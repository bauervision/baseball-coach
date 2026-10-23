// Guided New Season Setup write paths against this repo's firestore.rules:
// idempotent team and season creation, draft resumption, snapshots,
// roster import, explicit activation, and Tigers preservation.
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { admin, clearFirestore, clientDb, closeClients, getData, seed } from "./support.mjs";
import {
  addPlayersToRoster,
  createSeasonOrResume,
  makeCurrentSeason,
} from "../../src/app/(protected)/admin/_parts/adminActions.ts";
import { createTeamIdempotent, listTeams } from "../../src/lib/teamStore.ts";
import { ensureManagedIdentity, linkExistingChild, listLinkedPlayers } from "../../src/lib/coachPlayersStore.ts";
import { LEGACY_TIGERS_BRANDING, snapshotFromTeam } from "../../src/lib/branding.ts";
import { DARK_TOKENS, LIGHT_TOKENS } from "../../src/lib/themeTokens.ts";
import { planSeason } from "../../src/lib/seasonSetup.ts";
import { listSeasons } from "../../src/lib/seasonStore.ts";
import { statsDigest } from "../../tools/identity/audit.mjs";
import { loadSnapshot, toJson } from "../../tools/identity/firestore.mjs";
import { COACH_UID, IDS, legacySnapshot } from "../support/fixtures.mjs";

const FALCONS = {
  teamId: "falcons-ab12", teamName: "Falcons", shortName: "FAL", sport: "softball", division: "10U", logo: null,
  palettes: { dark: { ...DARK_TOKENS, primary: "#2563eb", secondary: "#14b8a6" }, light: { ...LIGHT_TOKENS, primary: "#1d4ed8", secondary: "#0f766e" } },
  awardCollection: "original",
};
const SEASON = { seasonId: "falcons-spring-2027", seasonLabel: "Spring 2027" };

let db;
beforeEach(async () => {
  await clearFirestore();
  await seed(legacySnapshot(), [COACH_UID]);
  db = clientDb(COACH_UID);
});
after(closeClients);

// Fingerprint of the two original Tigers seasons (stats, games, lines, and
// every season field incl. awards/layouts) plus app/config.
async function tigers() {
  const s = toJson(await loadSnapshot(admin));
  s.seasons = s.seasons.filter((x) => x.seasonId === "tigers-2026" || x.seasonId === "tigers-fall-2026");
  return statsDigest(s) + JSON.stringify(s.seasons.map((x) => [x.data, x.players])) + JSON.stringify(s.config);
}

const create = (team = FALCONS, over = {}) =>
  createSeasonOrResume({ db, uid: COACH_UID, team, scheduledGames: 12, existingSeasonIds: [], ...SEASON, ...over });

test("team creation is idempotent: retries and double submits make one team", async () => {
  assert.equal(await createTeamIdempotent(db, FALCONS), "created");
  assert.equal(await createTeamIdempotent(db, FALCONS), "recovered", "retry after a lost response");
  const [a, b] = await Promise.all([
    createTeamIdempotent(db, { ...FALCONS, teamId: "hawks-0001", teamName: "Hawks" }),
    createTeamIdempotent(db, { ...FALCONS, teamId: "hawks-0001", teamName: "Hawks" }),
  ]);
  assert.deepEqual([a, b].sort(), ["created", "recovered"]);
  assert.deepEqual((await listTeams(db)).map((t) => t.teamId), ["falcons-ab12", "hawks-0001"]);
  await assert.rejects(createTeamIdempotent(db, { ...FALCONS, teamName: "Not Falcons" }), /different team/);
  assert.equal((await getData("teams/falcons-ab12")).teamName, "Falcons", "existing team unchanged");
});

test("season setup creates a draft with the team snapshot and never changes the current season", async () => {
  const before = await tigers();
  await createTeamIdempotent(db, FALCONS);
  assert.deepEqual(await create(), { seasonId: SEASON.seasonId, outcome: "created" });
  const s = await getData(`seasons/${SEASON.seasonId}`);
  assert.equal(s.status, "draft");
  assert.equal(s.teamId, FALCONS.teamId);
  assert.deepEqual(s.branding, snapshotFromTeam(FALCONS));
  assert.deepEqual(s.record, { wins: 0, losses: 0, ties: 0 });
  assert.equal((await getData("app/config")).currentSeasonId, "tigers-fall-2026");
  assert.equal(await tigers(), before, "Tigers seasons and config unchanged");
});

test("interrupted setup resumes the same draft; no duplicates, no merging", async () => {
  await createTeamIdempotent(db, FALCONS);
  await create();
  // Lost response / repeated submit: resumes rather than failing or duplicating.
  assert.equal((await create()).outcome, "resumed");
  const seasons = await listSeasons(db);
  assert.equal(seasons.filter((x) => x.teamId === FALCONS.teamId).length, 1);
  assert.equal(planSeason(seasons, FALCONS, "Spring", 2027).kind, "resume");

  // The same id for another team, or a non-draft, is refused.
  const hawks = { ...FALCONS, teamId: "hawks-0001", teamName: "Hawks" };
  await createTeamIdempotent(db, hawks);
  await assert.rejects(create(hawks), /already exists/);
  await makeCurrentSeason({ db, seasonId: SEASON.seasonId, uid: COACH_UID });
  await assert.rejects(create(), /already exists/, "an active season is never resumed as a draft");
  assert.equal((await getData(`seasons/${SEASON.seasonId}`)).teamId, FALCONS.teamId);
});

test("roster: returning players keep identity, linked child included, retries idempotent", async () => {
  await createTeamIdempotent(db, FALCONS);
  await create();
  // Coach's own child, linked via My Players (registry).
  await ensureManagedIdentity({ db, uid: COACH_UID, careerPlayerId: IDS.cole, displayName: "Cole Evans" });
  await linkExistingChild({ db, uid: COACH_UID, careerPlayerId: IDS.cole, displayName: "Cole Evans" });
  assert.deepEqual((await listLinkedPlayers(db, COACH_UID)).map((l) => l.careerPlayerId), [IDS.cole]);

  const imports = [
    { careerPlayerId: IDS.ava, name: "Ava Carter", linkedFrom: [{ seasonId: "tigers-fall-2026", seasonPlayerId: "07-ava-carter" }], number: "3", primaryPos: "SS", shirtSize: "YL" },
    { careerPlayerId: IDS.cole, name: "Cole Evans", linkedFrom: [{ seasonId: "tigers-fall-2026", seasonPlayerId: "03-cole-evans" }], number: "8", primaryPos: "", shirtSize: "" },
  ];
  const newPlayers = [{ careerPlayerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Kai New", number: "21", primaryPos: "", shirtSize: "" }];
  const first = await addPlayersToRoster({ db, seasonId: SEASON.seasonId, imports, newPlayers });
  assert.equal(first.writes.length, 3);
  const retry = await addPlayersToRoster({ db, seasonId: SEASON.seasonId, imports, newPlayers });
  assert.equal(retry.writes.length, 0, "retry adds nothing");
  const ava = await getData(`seasons/${SEASON.seasonId}/players/${IDS.ava}`);
  assert.equal(ava.careerPlayerId, IDS.ava);
  assert.ok(Object.values(ava.stats).every((v) => v === 0), "new season starts at zero");
  assert.equal((await getData("seasons/tigers-fall-2026/players/07-ava-carter")).stats.hits, 11, "history untouched");
});

test("activation is explicit: Make Current activates the draft and switches config", async () => {
  await createTeamIdempotent(db, FALCONS);
  await create();
  assert.equal((await getData("app/config")).currentSeasonId, "tigers-fall-2026");
  await makeCurrentSeason({ db, seasonId: SEASON.seasonId, uid: COACH_UID });
  const s = await getData(`seasons/${SEASON.seasonId}`);
  assert.equal(s.status, "active");
  assert.equal(s.lifecycleHistory.at(-1).action, "activated");
  assert.equal((await getData("app/config")).currentSeasonId, SEASON.seasonId);
  assert.equal((await getData("seasons/tigers-fall-2026")).status, undefined, "previous season untouched");
});

test("a Tigers team from the original branding gives new seasons the original look", async () => {
  const before = await tigers();
  const tigersTeam = { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "tigers-0001" };
  await createTeamIdempotent(db, tigersTeam);
  await create(tigersTeam, { seasonId: "tigers-spring-2027" });
  const s = await getData("seasons/tigers-spring-2027");
  assert.deepEqual(s.branding.palettes, LEGACY_TIGERS_BRANDING.palettes);
  assert.deepEqual(s.branding.logo, { kind: "bundled", id: "tigers" });
  // Historical seasons were not linked to the new team or changed at all.
  assert.equal((await getData("seasons/tigers-fall-2026")).teamId, undefined);
  assert.equal((await getData("seasons/tigers-2026")).branding, undefined);
  assert.equal(await tigers(), before);
});
