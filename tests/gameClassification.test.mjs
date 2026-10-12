import { test } from "node:test";
import assert from "node:assert/strict";

import {
  asGameType,
  computeOfficialSeasonTally,
  isOfficialGame,
} from "../src/lib/gameClassification.ts";

test("legacy games without a type are Regular Season", () => {
  assert.equal(asGameType(undefined), "regular");
  assert.equal(asGameType(null), "regular");
  assert.equal(asGameType("bogus"), "regular");
  assert.equal(asGameType("scrimmage"), "scrimmage");
  assert.equal(asGameType("makeup"), "makeup");
});

test("only scrimmages are unofficial", () => {
  assert.equal(isOfficialGame("regular"), true);
  assert.equal(isOfficialGame("makeup"), true);
  assert.equal(isOfficialGame("scrimmage"), false);
});

test("scrimmages are excluded from record and games played", () => {
  const tally = computeOfficialSeasonTally([
    { result: "W" }, // legacy, no type
    { result: "L", gameType: "regular" },
    { result: "W", gameType: "scrimmage" },
    { result: "L", gameType: "scrimmage" },
    { result: "T", gameType: "makeup" },
  ]);
  assert.deepEqual(tally, { wins: 1, losses: 1, ties: 1, gamesPlayed: 3 });
});

test("a make-up game counts exactly once", () => {
  // The postponed fixture never has its own game doc, so the make-up record
  // is the single entry for it.
  const tally = computeOfficialSeasonTally([
    { result: "W", gameType: "regular" },
    { result: "W", gameType: "makeup" },
  ]);
  assert.equal(tally.gamesPlayed, 2);
  assert.equal(tally.wins, 2);
});

test("all-legacy seasons keep their existing totals", () => {
  const games = Array.from({ length: 10 }, (_, i) => ({
    result: i % 2 ? "L" : "W",
  }));
  assert.deepEqual(computeOfficialSeasonTally(games), {
    wins: 5,
    losses: 5,
    ties: 0,
    gamesPlayed: 10,
  });
});

test("result casing and whitespace are tolerated", () => {
  const tally = computeOfficialSeasonTally([{ result: " w " }, { result: 7 }]);
  assert.equal(tally.wins, 1);
  assert.equal(tally.gamesPlayed, 2);
});
