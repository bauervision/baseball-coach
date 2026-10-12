import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dirtyPlayerIds,
  hasUnsavedGameChanges,
} from "../src/app/(protected)/admin/unsavedEdits.ts";

const zero = { atBats: 0, hits: 0 };

function form(overrides = {}) {
  return {
    lines: { p1: { delta: { ...zero } }, p2: { delta: { ...zero } } },
    coachPicks: { charlieHustle: "" },
    gameBallPlayerId: "",
    gameType: "regular",
    date: "2026-05-01",
    opponent: "Cubs",
    result: "W",
    scoreUs: "0",
    scoreThem: "0",
    ...overrides,
  };
}

test("editing a second player keeps the first player's edits pending", () => {
  const baseline = form();
  const afterP1 = { ...baseline.lines, p1: { delta: { atBats: 3, hits: 1 } } };
  const afterP2 = { ...afterP1, p2: { delta: { atBats: 2, hits: 0 } } };

  assert.deepEqual([...dirtyPlayerIds(afterP1, baseline.lines)], ["p1"]);
  assert.deepEqual(
    [...dirtyPlayerIds(afterP2, baseline.lines)].sort(),
    ["p1", "p2"],
  );
});

test("reverting an edit clears that player's unsaved state", () => {
  const baseline = form();
  const lines = { ...baseline.lines, p1: { delta: { ...zero } } };
  assert.equal(dirtyPlayerIds(lines, baseline.lines).size, 0);
});

test("missing baseline rows are treated as all zeros", () => {
  assert.equal(dirtyPlayerIds({ p1: { delta: { ...zero } } }, {}).size, 0);
  assert.equal(dirtyPlayerIds({ p1: { delta: { hits: 1 } } }, {}).size, 1);
});

test("after a successful save the submitted form is the new baseline", () => {
  const edited = form({
    lines: { p1: { delta: { atBats: 3, hits: 1 } }, p2: { delta: { ...zero } } },
  });
  assert.equal(hasUnsavedGameChanges(edited, form()), true);
  assert.equal(hasUnsavedGameChanges(edited, edited), false);
});

test("a failed save leaves the edits unsaved", () => {
  const baseline = form();
  const edited = form({ scoreUs: "7" });
  // On failure the baseline is not replaced.
  assert.equal(hasUnsavedGameChanges(edited, baseline), true);
});

test("game-level fields count as unsaved changes", () => {
  const b = form();
  assert.equal(hasUnsavedGameChanges(form({ gameType: "scrimmage" }), b), true);
  assert.equal(hasUnsavedGameChanges(form({ gameBallPlayerId: "p1" }), b), true);
  assert.equal(
    hasUnsavedGameChanges(form({ coachPicks: { charlieHustle: "p2" } }), b),
    true,
  );
  assert.equal(hasUnsavedGameChanges(form({ opponent: "Mets" }), b), true);
});

test("an emptied score mid-edit is not a change from 0", () => {
  assert.equal(hasUnsavedGameChanges(form({ scoreUs: "" }), form()), false);
});
