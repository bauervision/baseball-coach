import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { computeLeaders } from "../src/lib/roster.ts";
import {
  WITHIN_REACH_THRESHOLDS,
  behindLeaderGap,
  behindLeaderText,
  behindLeaderTone,
  computeWithinReach,
} from "../src/lib/withinReach.ts";

const ZERO = {
  games: 0,
  plateAppearances: 0,
  atBats: 0,
  hits: 0,
  longestHitStreak: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  runs: 0,
  rbi: 0,
  walks: 0,
  hitByPitch: 0,
  stolenBases: 0,
  putOuts: 0,
  assists: 0,
  pitchingStrikeouts: 0,
  pitchingSaves: 0,
  flyBallCatches: 0,
};

const player = (id, stats = {}, extra = {}) => ({
  id,
  name: id,
  number: 1,
  stats: { ...ZERO, ...stats },
  ...extra,
});

// Same pipeline as the page: LEAD map from computeLeaders, then gaps.
function reachFor(players, id) {
  return computeWithinReach(players, id, computeLeaders(players));
}

test("exact text, never abbreviated", () => {
  assert.equal(behindLeaderText(1), "1 behind leader");
  assert.equal(behindLeaderText(2), "2 behind leader");
  assert.equal(behindLeaderText(3), "3 behind leader");
});

test("1 behind is emphasized; 2 and 3 behind are neutral", () => {
  assert.equal(behindLeaderTone(1), "emphasis");
  assert.equal(behindLeaderTone(2), "neutral");
  assert.equal(behindLeaderTone(3), "neutral");
});

test("thresholds are exactly as specified", () => {
  assert.deepEqual(WITHIN_REACH_THRESHOLDS, {
    hits: 2,
    runs: 2,
    rbi: 2,
    walks: 2,
    doubles: 1,
    triples: 1,
    homeRuns: 1,
    longestHitStreak: 1,
    stolenBases: 3,
    putOuts: 3,
    assists: 3,
    pitchingStrikeouts: 3,
  });
});

test("one behind and two behind are shown", () => {
  const roster = [
    player("lead", { hits: 6, rbi: 5 }),
    player("me", { hits: 5, rbi: 3 }),
  ];
  assert.deepEqual(reachFor(roster, "me"), { hits: 1, rbi: 2 });
});

test("three behind only for 3-threshold categories", () => {
  const roster = [
    player("lead", { stolenBases: 4, putOuts: 4, assists: 4, pitchingStrikeouts: 4, hits: 4, runs: 4 }),
    player("me", { stolenBases: 1, putOuts: 1, assists: 1, pitchingStrikeouts: 1, hits: 1, runs: 1 }),
  ];
  assert.deepEqual(reachFor(roster, "me"), {
    stolenBases: 3,
    putOuts: 3,
    assists: 3,
    pitchingStrikeouts: 3,
  });
});

test("extra-base hits show only at exactly 1 behind", () => {
  const roster = [
    player("lead", { doubles: 3, triples: 2, homeRuns: 3 }),
    player("me", { doubles: 2, triples: 0, homeRuns: 1 }),
  ];
  assert.deepEqual(reachFor(roster, "me"), { doubles: 1 });
});

test("outside the threshold is hidden", () => {
  const roster = [
    player("lead", { hits: 10, stolenBases: 9 }),
    player("me", { hits: 7, stolenBases: 5 }),
  ];
  assert.deepEqual(reachFor(roster, "me"), {});
});

test("a zero-valued player is hidden even when the gap is small", () => {
  const roster = [player("lead", { hits: 1, doubles: 1 }), player("me")];
  assert.deepEqual(reachFor(roster, "me"), {});
});

test("leader and tied leaders get no indicator", () => {
  const roster = [
    player("a", { hits: 5 }),
    player("b", { hits: 5 }),
    player("c", { hits: 4 }),
  ];
  assert.deepEqual(computeLeaders(roster).hits.sort(), ["a", "b"]);
  assert.deepEqual(reachFor(roster, "a"), {});
  assert.deepEqual(reachFor(roster, "b"), {});
  assert.deepEqual(reachFor(roster, "c"), { hits: 1 });
});

test("ineligible categories never show", () => {
  const roster = [
    player("lead", { games: 5, plateAppearances: 9, atBats: 8, hitByPitch: 3, pitchingSaves: 2, flyBallCatches: 2 }),
    player("me", { games: 4, plateAppearances: 8, atBats: 7, hitByPitch: 2, pitchingSaves: 1, flyBallCatches: 1 }),
  ];
  assert.deepEqual(reachFor(roster, "me"), {});
  for (const key of ["games", "plateAppearances", "atBats", "avg", "obp", "slg", "ops", "hitByPitch"]) {
    assert.equal(behindLeaderGap({ key, playerValue: 1, leaderValue: 2 }), null, key);
  }
});

test("missing or invalid leader data is hidden", () => {
  const roster = [player("me", { hits: 3 })];
  assert.deepEqual(computeWithinReach(roster, "me", {}), {});
  assert.deepEqual(computeWithinReach(roster, "me", { hits: [] }), {});
  assert.deepEqual(computeWithinReach(roster, "me", { hits: ["ghost"] }), {});

  const bad = [player("lead", { hits: Number.NaN }), player("me", { hits: 3 })];
  assert.deepEqual(computeWithinReach(bad, "me", { hits: ["lead"] }), {});

  // Leaders disagreeing on value means the LEAD data is unreliable.
  const mixed = [player("a", { hits: 5 }), player("b", { hits: 4 }), player("me", { hits: 3 })];
  assert.deepEqual(computeWithinReach(mixed, "me", { hits: ["a", "b"] }), {});

  for (const leaderValue of [undefined, null, "5", -1, 2.5, Infinity]) {
    assert.equal(behindLeaderGap({ key: "hits", playerValue: 1, leaderValue }), null);
  }
});

test("players hidden from the leaderboard are outside LEAD scope", () => {
  const roster = [
    player("lead", { hits: 5 }),
    player("me", { hits: 4 }, { leaderboardHidden: true }),
    player("hiddenTop", { hits: 9 }, { leaderboardHidden: true }),
    player("you", { hits: 4 }),
  ];
  assert.deepEqual(reachFor(roster, "me"), {});
  // A hidden player's higher total doesn't become the comparison target.
  assert.deepEqual(reachFor(roster, "you"), { hits: 1 });
});

test("updates when leader or player stats change", () => {
  const before = [player("lead", { hits: 5 }), player("me", { hits: 3 })];
  assert.deepEqual(reachFor(before, "me"), { hits: 2 });

  const meImproved = [player("lead", { hits: 5 }), player("me", { hits: 4 })];
  assert.deepEqual(reachFor(meImproved, "me"), { hits: 1 });

  const leaderPulledAway = [player("lead", { hits: 7 }), player("me", { hits: 4 })];
  assert.deepEqual(reachFor(leaderPulledAway, "me"), {});

  const meTied = [player("lead", { hits: 7 }), player("me", { hits: 7 })];
  assert.deepEqual(reachFor(meTied, "me"), {});
});

test("existing stat card labels are unchanged", () => {
  const src = readFileSync(
    new URL("../src/app/player/PlayerPageClient.tsx", import.meta.url),
    "utf8",
  );
  for (const label of [
    "RBIs: Runs Batted In",
    "Base on Balls (Walk)",
    "Longest Hit Streak",
    "Stolen Bases",
    "Pitching Strike Outs",
    "Put Outs (PO)",
    "Assists (A)",
  ]) {
    assert.ok(src.includes(`label="${label}"`), label);
  }
});
