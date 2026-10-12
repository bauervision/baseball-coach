import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  GAME_LOG_STAT_GROUPS,
  gameLogHighlights,
  gameLogHitStreaks,
  gameLogStatGroups,
  gameLogSummary,
  normalizeGameLogDelta,
  singlesFrom,
} from "../src/lib/playerGameLog.ts";

// Keys of the admin's EMPTY_DELTA — the stats an admin can actually enter.
function adminLineDeltaKeys() {
  const src = readFileSync(
    new URL("../src/app/(protected)/admin/adminHelpers.ts", import.meta.url),
    "utf8",
  );
  const body = /export const EMPTY_DELTA: LineDelta = \{([\s\S]*?)\};/.exec(src);
  assert.ok(body, "EMPTY_DELTA not found in adminHelpers.ts");
  return [...body[1].matchAll(/(\w+):\s*0/g)].map((m) => m[1]);
}

const statKeys = () =>
  GAME_LOG_STAT_GROUPS.flatMap((g) => g.stats.map((s) => s.key));

test("every stat the admin can enter maps to the Game Log", () => {
  const adminKeys = adminLineDeltaKeys();
  assert.equal(adminKeys.length, 15);
  const logKeys = new Set(statKeys());
  for (const k of adminKeys) assert.ok(logKeys.has(k), `missing ${k}`);

  const normalized = normalizeGameLogDelta({});
  for (const k of adminKeys) assert.equal(normalized[k], 0, k);
});

test("the Game Log invents no stored fields beyond the admin's", () => {
  const adminKeys = new Set(adminLineDeltaKeys());
  // singles is derived; strikeouts is a legacy-only stored field.
  const extra = statKeys().filter((k) => !adminKeys.has(k));
  assert.deepEqual(extra.sort(), ["singles", "strikeouts"]);
});

test("big game: exact counts for doubles, SB, strikeouts, PO, A", () => {
  const d = normalizeGameLogDelta({
    atBats: 4,
    hits: 3,
    doubles: 2,
    runs: 2,
    rbi: 3,
    stolenBases: 3,
    putOuts: 5,
    assists: 4,
    pitchingStrikeouts: 6,
    flyBallCatches: 2,
  });

  const highlights = Object.fromEntries(
    gameLogHighlights(d).map((s) => [s.key, s.value]),
  );
  assert.deepEqual(highlights, {
    doubles: 2,
    stolenBases: 3,
    putOuts: 5,
    assists: 4,
    flyBallCatches: 2,
    pitchingStrikeouts: 6,
  });
  assert.equal(singlesFrom(d), 1);
  assert.equal(gameLogSummary(d), "3 for 4 • 2 runs • 3 RBI");
});

test("compact view suppresses zeros; full view lists them", () => {
  const d = normalizeGameLogDelta({ atBats: 3, hits: 1 });
  assert.deepEqual(gameLogHighlights(d), []);

  const full = gameLogStatGroups(d);
  assert.deepEqual(
    full.map((g) => g.label),
    ["Batting", "Baserunning", "Fielding", "Pitching"],
  );
  const all = full.flatMap((g) => g.stats);
  assert.equal(all.length, 16); // 15 admin fields + derived singles
  // AB, H and derived 1B are nonzero; the other 13 are listed as zeros.
  assert.equal(all.filter((s) => s.value === 0).length, 13);
  assert.equal(all.find((s) => s.key === "singles").value, 1);
});

test("legacy lines with missing or malformed fields read as zero", () => {
  const d = normalizeGameLogDelta({
    atBats: 3,
    hits: "2",
    doubles: null,
    walks: -1,
    runs: 1.9,
  });
  assert.equal(d.atBats, 3);
  assert.equal(d.hits, 0);
  assert.equal(d.doubles, 0);
  assert.equal(d.walks, 0);
  assert.equal(d.runs, 1);
  assert.equal(d.putOuts, 0);
  assert.equal(normalizeGameLogDelta(undefined).hits, 0);
});

test("legacy batter strikeouts appear only when stored", () => {
  const without = gameLogStatGroups(normalizeGameLogDelta({ atBats: 2 }));
  assert.ok(!without.flatMap((g) => g.stats).some((s) => s.key === "strikeouts"));

  const legacy = normalizeGameLogDelta({ atBats: 3, strikeouts: 2 });
  const row = gameLogStatGroups(legacy)
    .flatMap((g) => g.stats)
    .find((s) => s.key === "strikeouts");
  assert.equal(row.value, 2);
  assert.ok(gameLogHighlights(legacy).some((s) => s.key === "strikeouts"));
});

test("singles never go negative on inconsistent data", () => {
  assert.equal(singlesFrom(normalizeGameLogDelta({ hits: 1, homeRuns: 2 })), 0);
});

test("hit streak matches the original log; coach-only games are neutral", () => {
  const g = (gameId, date, hits, extra = {}) => ({
    gameId,
    date,
    hasStatLine: true,
    gotGameBall: false,
    delta: { hits },
    ...extra,
  });
  const streaks = gameLogHitStreaks([
    g("g4", "2026-04-04", 1),
    g("g1", "2026-04-01", 1),
    g("g2", "2026-04-02", 2),
    // Coach Choice only, no stat line: previously not in the log.
    g("g3", "2026-04-03", 0, { hasStatLine: false }),
    // Game Ball only, no stat line: previously in the log, reset streak.
    g("g5", "2026-04-05", 0, { hasStatLine: false, gotGameBall: true }),
    g("g6", "2026-04-06", 1),
  ]);
  assert.deepEqual(Object.fromEntries(streaks), {
    g1: 1,
    g2: 2,
    g3: 0,
    g4: 3,
    g5: 0,
    g6: 1,
  });
});
