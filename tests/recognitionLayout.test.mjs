import { test } from "node:test";
import assert from "node:assert/strict";

import {
  autoCardKeys,
  canSwapSlots,
  normalizeSavedOrder,
  reconcileOrder,
  sameOrder,
  swapSlots,
  visibleSlotCount,
} from "../src/lib/recognitionLayout.ts";

test("auto order lists earned awards, then runner-ups that fit", () => {
  assert.deepEqual(autoCardKeys(["slugger"], ["walk_wizard", "hit_leader"]), [
    "earned-slugger",
    "runnerup-walk_wizard",
    "runnerup-hit_leader",
  ]);
  assert.deepEqual(
    autoCardKeys(["a", "b"], ["c", "d", "e"]),
    ["earned-a", "earned-b", "runnerup-c", "runnerup-d"],
  );
  assert.deepEqual(autoCardKeys(["a", "b", "c", "d"], ["e"]), [
    "earned-a",
    "earned-b",
    "earned-c",
    "earned-d",
  ]);
});

test("visible slots match the sheet's panels and Honors thumbnails", () => {
  assert.equal(visibleSlotCount(0, 0), 0);
  assert.equal(visibleSlotCount(3, 3), 3);
  assert.equal(visibleSlotCount(4, 5), 4);
  assert.equal(visibleSlotCount(6, 6), 4);
  assert.equal(visibleSlotCount(6, 7), 6);
  assert.equal(visibleSlotCount(9, 10), 7);
  assert.equal(visibleSlotCount(5, 9), 5);
});

test("no saved order means the automatic order", () => {
  const auto = ["earned-a", "earned-b"];
  assert.deepEqual(reconcileOrder(auto, null), auto);
  assert.deepEqual(reconcileOrder(auto, []), auto);
});

test("a valid saved order is applied as-is", () => {
  const auto = ["earned-a", "earned-b", "earned-c"];
  const saved = ["earned-c", "earned-a", "earned-b"];
  assert.deepEqual(reconcileOrder(auto, saved), saved);
});

test("an award that is no longer earned is dropped, other slots kept", () => {
  const auto = ["earned-a", "earned-b", "earned-d"];
  const saved = ["earned-c", "earned-b", "earned-a"];
  // Slot 0's award (c) is gone; b and a keep their slots; d fills the gap.
  assert.deepEqual(reconcileOrder(auto, saved), [
    "earned-d",
    "earned-b",
    "earned-a",
  ]);
});

test("newly earned awards fill remaining slots in automatic order", () => {
  const auto = ["earned-a", "earned-b", "earned-new1", "earned-new2"];
  const saved = ["earned-b", "earned-a"];
  assert.deepEqual(reconcileOrder(auto, saved), [
    "earned-b",
    "earned-a",
    "earned-new1",
    "earned-new2",
  ]);
});

test("valid saved awards beyond the slot count move up, not out", () => {
  const auto = ["earned-a", "earned-b"];
  const saved = ["earned-x", "earned-y", "earned-a", "earned-b"];
  assert.deepEqual(reconcileOrder(auto, saved), ["earned-a", "earned-b"]);
});

test("reconciliation never puts a runner-up in the featured slot", () => {
  const auto = ["earned-a", "runnerup-b", "runnerup-c"];
  const saved = ["earned-gone", "runnerup-c", "runnerup-b"];
  const out = reconcileOrder(auto, saved);
  assert.equal(out[0], "earned-a");
  assert.deepEqual([...out].sort(), [...auto].sort());
});

test("reconciliation is always a permutation of the current cards", () => {
  const auto = ["earned-a", "earned-b", "earned-c", "runnerup-d"];
  const cases = [
    ["earned-c", "earned-c", "junk", "earned-a"],
    ["runnerup-d", "earned-a"],
    ["earned-z"],
  ];
  for (const saved of cases) {
    const out = reconcileOrder(auto, saved);
    assert.deepEqual([...out].sort(), [...auto].sort());
    assert.ok(!out[0].startsWith("runnerup-"));
  }
});

test("swaps exchange two slots and refuse a runner-up as featured", () => {
  const order = ["earned-a", "earned-b", "runnerup-c"];
  assert.deepEqual(swapSlots(order, 0, 1), ["earned-b", "earned-a", "runnerup-c"]);
  assert.ok(canSwapSlots(order, 0, 1));
  assert.ok(canSwapSlots(order, 1, 2));
  assert.ok(!canSwapSlots(order, 0, 2));
  assert.ok(!canSwapSlots(order, 1, 1));
  assert.ok(!canSwapSlots(order, 0, 3));
  // A player with only runner-up finishes may feature any of them.
  assert.ok(canSwapSlots(["runnerup-a", "runnerup-b"], 0, 1));
});

test("saved orders from storage are sanitized", () => {
  assert.equal(normalizeSavedOrder(undefined), null);
  assert.equal(normalizeSavedOrder("earned-a"), null);
  assert.equal(normalizeSavedOrder([]), null);
  assert.deepEqual(normalizeSavedOrder(["earned-a", 3, "", "earned-a", "earned-b"]), [
    "earned-a",
    "earned-b",
  ]);
  assert.ok(sameOrder(["a", "b"], ["a", "b"]));
  assert.ok(!sameOrder(["a", "b"], ["b", "a"]));
});
