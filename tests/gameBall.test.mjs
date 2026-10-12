import { test } from "node:test";
import assert from "node:assert/strict";

import { groupGameBallPlayers } from "../src/lib/gameBall.ts";

const players = [
  { id: "c", name: "Cam", number: 12 },
  { id: "a", name: "Ari", number: 3 },
  { id: "b", name: "Bo", number: 7 },
  { id: "d", name: "Dee", number: 3 },
];

const games = [
  { id: "g1", gameBallPlayerId: "b" },
  { id: "g2", gameBallPlayerId: "b" },
  { id: "g3", gameBallPlayerId: "c" },
  { id: "g4", gameBallPlayerId: "" },
];

test("splits first-time and previous recipients, all selectable", () => {
  const groups = groupGameBallPlayers(players, games, null);
  assert.deepEqual(
    groups.firstTime.map((p) => p.id),
    ["a", "d"], // sorted by number, then name
  );
  assert.deepEqual(
    groups.previous.map(({ player, count }) => [player.id, count]),
    [
      ["b", 2],
      ["c", 1],
    ],
  );
  assert.equal(groups.firstTime.length + groups.previous.length, players.length);
});

test("the game being edited does not count against its own pick", () => {
  const groups = groupGameBallPlayers(players, games, "g3");
  assert.ok(groups.firstTime.some((p) => p.id === "c"));
  const bo = groups.previous.find(({ player }) => player.id === "b");
  assert.equal(bo?.count, 2);
});

test("a repeat recipient keeps an accurate count when editing one of their games", () => {
  const groups = groupGameBallPlayers(players, games, "g1");
  const bo = groups.previous.find(({ player }) => player.id === "b");
  assert.equal(bo?.count, 1);
});

test("no saved games means everyone is first-time", () => {
  const groups = groupGameBallPlayers(players, [], null);
  assert.equal(groups.firstTime.length, 4);
  assert.equal(groups.previous.length, 0);
});
