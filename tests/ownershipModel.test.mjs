// Coach-owned player model: history is permanent, ongoing tracking follows
// the coach's roster decisions, and nothing crosses to another coach.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCandidatesFromRosters,
  defaultSelectedKeys,
  mergeRegistryCandidates,
  searchCandidates,
} from "../src/lib/playerSearch.ts";
import {
  aggregateCareerStats,
  resolveCareerParticipations,
} from "../src/lib/careerHistory.ts";
import { planRosterAdditions } from "../src/lib/rosterPlanning.ts";
import {
  COACH_UID,
  IDS,
  OTHER_COACH_UID,
  legacySnapshot,
  participation,
  rosterSeasons,
  stats,
} from "./support/fixtures.mjs";

const LUKE = "99999999-9999-4999-8999-999999999999";

function confirmed(snap) {
  for (const s of snap.seasons) for (const p of s.players) p.data.identityStatus = "confirmed";
  return snap;
}

/** Next season on a brand-new team, with only Ava imported. */
function withNextSeason(snap) {
  snap.seasons.push({
    seasonId: "broncos-spring-2027",
    data: { teamName: "Broncos", seasonLabel: "Spring 2027", coachUids: [COACH_UID] },
    players: [
      {
        id: IDS.ava,
        data: {
          name: "Ava Carter",
          number: 7,
          careerPlayerId: IDS.ava,
          identityStatus: "confirmed",
          linkedFrom: [{ seasonId: "tigers-fall-2026", seasonPlayerId: "07-ava-carter" }],
          stats: stats(),
        },
      },
    ],
  });
  return snap;
}

test("a player who leaves keeps their full history", () => {
  const snap = withNextSeason(confirmed(legacySnapshot()));
  // Finn played Fall 2026 and was not brought back for Spring 2027.
  const finn = participation(snap, "tigers-fall-2026", "11-finn-hale");
  const others = snap.seasons
    .filter((s) => s.seasonId !== "tigers-fall-2026")
    .flatMap((s) => s.players.map((p) => participation(snap, s.seasonId, p.id)));
  const career = resolveCareerParticipations(finn, others);
  assert.deepEqual(career.map((p) => p.season.seasonLabel), ["Fall 2026"]);
  assert.equal(aggregateCareerStats(career).hits, 6, "Fall stats intact");
  assert.equal(finn.season.finalAwards.mvp, "09-dana-fox", "season awards untouched");
});

test("a former player is never placed on the next roster automatically", () => {
  const snap = withNextSeason(confirmed(legacySnapshot()));
  const candidates = buildCandidatesFromRosters(rosterSeasons(snap), {
    uid: COACH_UID,
    excludeSeasonId: "broncos-spring-2027",
  });
  // Nothing is preselected unless it is a linked child.
  assert.deepEqual(defaultSelectedKeys(candidates, () => false), []);
  // An empty import adds nobody.
  const plan = planRosterAdditions({ existing: [], imports: [], newPlayers: [] });
  assert.equal(plan.writes.length, 0);
});

test("a former player stays available for an explicit returning-player import", () => {
  const snap = withNextSeason(confirmed(legacySnapshot()));
  const candidates = buildCandidatesFromRosters(rosterSeasons(snap), {
    uid: COACH_UID,
    excludeSeasonId: "broncos-spring-2027",
  });
  const [finn] = searchCandidates(candidates, "finn");
  assert.equal(finn.careerPlayerId, IDS.finn);
  assert.equal(finn.seasons[0].seasonLabel, "Fall 2026");

  const plan = planRosterAdditions({
    existing: [{ id: IDS.ava, name: "Ava Carter", number: 7, careerPlayerId: IDS.ava }],
    imports: [
      {
        careerPlayerId: finn.careerPlayerId,
        name: finn.displayName,
        linkedFrom: finn.seasons.map(({ seasonId, seasonPlayerId }) => ({ seasonId, seasonPlayerId })),
        number: "11",
        primaryPos: "",
        shirtSize: "",
      },
    ],
    newPlayers: [],
  });
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.writes[0].data.careerPlayerId, IDS.finn, "same identity when he returns");
});

test("a linked child is preselected on a new team and can be deselected", () => {
  const snap = confirmed(legacySnapshot());
  // Luke has never played for this coach; the coach now runs a new team.
  const candidates = mergeRegistryCandidates(
    buildCandidatesFromRosters(rosterSeasons(snap), { uid: COACH_UID }),
    [{ careerPlayerId: LUKE, displayName: "Luke Bauer" }],
    new Set([LUKE]),
  );
  const preselected = defaultSelectedKeys(candidates, () => false);
  assert.deepEqual(preselected, [`id:${LUKE}`]);

  // Deselecting is a roster choice only: the submitted roster omits him,
  // and he remains a linked candidate for the next roster.
  const plan = planRosterAdditions({ existing: [], imports: [], newPlayers: [] });
  assert.equal(plan.writes.length, 0);
  assert.ok(candidates.find((c) => c.careerPlayerId === LUKE).linkedChild);
  assert.deepEqual(defaultSelectedKeys(candidates, () => false), preselected);
});

test("career history is unchanged when a player skips a season", () => {
  const snap = confirmed(legacySnapshot());
  // Eli played Spring 2026, skipped Fall 2026, returns Spring 2027.
  const spring = participation(snap, "tigers-2026", "05-eli-grant");
  const returning = {
    seasonId: "tigers-spring-2027",
    seasonPlayerId: IDS.eli,
    careerPlayerId: IDS.eli,
    identityStatus: "confirmed",
    linkedFrom: [{ seasonId: "tigers-2026", seasonPlayerId: "05-eli-grant" }],
    name: "Eli Grant",
    number: 5,
    stats: stats({ games: 1, atBats: 3, hits: 2 }),
    season: { teamName: "Tigers", seasonLabel: "Spring 2027" },
  };
  const fall = snap.seasons[1].players.map((p) => participation(snap, "tigers-fall-2026", p.id));
  const career = resolveCareerParticipations(returning, [spring, ...fall]);
  assert.deepEqual(career.map((p) => p.season.seasonLabel), ["Spring 2026", "Spring 2027"]);
  assert.equal(aggregateCareerStats(career).hits, 3 + 2);

  // Viewed from the earlier season, the same two seasons and totals.
  const fromSpring = resolveCareerParticipations(spring, [returning, ...fall]);
  assert.deepEqual(fromSpring.map((p) => p.seasonId), career.map((p) => p.seasonId));
});

test("a former player's seasons with another coach are never discovered", () => {
  const snap = confirmed(legacySnapshot());
  // Finn later plays for a different coach, who records him on their team.
  snap.seasons.push({
    seasonId: "hawks-spring-2027",
    data: { teamName: "Hawks", seasonLabel: "Spring 2027", coachUids: [OTHER_COACH_UID] },
    players: [
      { id: "h-finn", data: { name: "Finn Hale", number: 3, careerPlayerId: IDS.finn, identityStatus: "confirmed" } },
    ],
  });
  const mine = buildCandidatesFromRosters(rosterSeasons(snap), { uid: COACH_UID });
  const finn = mine.filter((c) => c.displayName === "Finn Hale");
  assert.equal(finn.length, 1);
  assert.deepEqual(finn[0].seasons.map((s) => s.teamName), ["Tigers"], "no Hawks season");
  assert.ok(mine.every((c) => c.seasons.every((s) => s.seasonId !== "hawks-spring-2027")));
});
