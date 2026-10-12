import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COACH_PICK_FIELDS,
  recognitionsForPlayer,
} from "../src/lib/coachRecognition.ts";

const award = (playerId) => ({ playerId, playerName: "x", playerNumber: 1 });

test("titles cover exactly the admin's coach pick keys", () => {
  const src = readFileSync(
    new URL("../src/app/(protected)/admin/adminHelpers.ts", import.meta.url),
    "utf8",
  );
  const body = /export const EMPTY_COACH_PICKS: CoachPicks = \{([\s\S]*?)\};/.exec(
    src,
  );
  assert.ok(body);
  const adminKeys = [...body[1].matchAll(/(\w+):\s*""/g)].map((m) => m[1]);
  assert.deepEqual(
    COACH_PICK_FIELDS.map((f) => f.key).sort(),
    adminKeys.sort(),
  );
});

test("multiple Coach Choices plus Game Ball in one game, exact titles", () => {
  const game = {
    gameBall: award("p1"),
    coachAwards: {
      bestShortstop: award("p1"),
      charlieHustle: award("p1"),
      bestPitcher: award("p2"),
    },
  };
  assert.deepEqual(
    recognitionsForPlayer(game, "p1").map((r) => r.title),
    ["Game Ball", "Charlie Hustle", "Best SS"],
  );
  assert.deepEqual(
    recognitionsForPlayer(game, "p2").map((r) => r.title),
    ["Best Pitcher"],
  );
});

test("repeat Game Balls across games each show", () => {
  const games = [
    { gameBall: award("p1") },
    { gameBall: award("p1"), coachAwards: {} },
    { gameBall: award("p2") },
  ];
  const balls = games.filter((g) =>
    recognitionsForPlayer(g, "p1").some((r) => r.isGameBall),
  );
  assert.equal(balls.length, 2);
});

test("every admin title is passed through unchanged", () => {
  for (const { key, label } of COACH_PICK_FIELDS) {
    const r = recognitionsForPlayer({ coachAwards: { [key]: award("p") } }, "p");
    assert.deepEqual(r, [{ key, title: label, isGameBall: false }]);
  }
});

test("games without recognition, and legacy/malformed fields, yield none", () => {
  assert.deepEqual(recognitionsForPlayer({}, "p1"), []);
  assert.deepEqual(
    recognitionsForPlayer({ gameBall: null, coachAwards: null }, "p1"),
    [],
  );
  assert.deepEqual(
    recognitionsForPlayer(
      { gameBall: "p1", coachAwards: { bestCatcher: "p1", mvp: { playerId: 7 } } },
      "p1",
    ),
    [],
  );
  assert.deepEqual(recognitionsForPlayer({ gameBall: award("p1") }, ""), []);
});

test("an unknown pick key still shows, with a readable title", () => {
  const r = recognitionsForPlayer(
    { coachAwards: { bestDesignatedHitter: award("p1") } },
    "p1",
  );
  assert.deepEqual(r.map((x) => x.title), ["Best Designated Hitter"]);
});
