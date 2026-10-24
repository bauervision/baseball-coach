import { test } from "node:test";
import assert from "node:assert/strict";

import { rosterBlockers, seasonDocBlockers } from "../src/lib/draftDeletion.ts";
import { asSeasonStatus, isWritable, visibleToViewers } from "../src/lib/seasonLifecycle.ts";

const freshDraft = {
  status: "draft", teamId: "tigers-0001", teamName: "Tigers", seasonLabel: "Spring 2027", gamesPlayed: 0,
  record: { wins: 0, losses: 0, ties: 0 }, endSeasonMode: false,
  finalAwards: { mvp: "", dominator: "", honorableMention: "", bestAllAround: "", bestAttitude: "" },
};

test("an unused, non-current draft is eligible; an interrupted deletion can resume", () => {
  assert.deepEqual(seasonDocBlockers(freshDraft, { isCurrent: false }), []);
  assert.deepEqual(seasonDocBlockers({ ...freshDraft, status: "deleting" }, { isCurrent: false }), []);
  assert.deepEqual(seasonDocBlockers({ status: "draft" }, { isCurrent: false }), [], "missing optional fields are fine");
});

test("legacy, active, finalized, current, and missing seasons are never eligible", () => {
  assert.match(seasonDocBlockers({ ...freshDraft, status: undefined }, { isCurrent: false }).join(), /before drafts/);
  assert.match(seasonDocBlockers({ ...freshDraft, status: "active" }, { isCurrent: false }).join(), /Only draft/);
  assert.match(seasonDocBlockers({ ...freshDraft, status: "finalized" }, { isCurrent: false }).join(), /Finalized/);
  assert.match(seasonDocBlockers(freshDraft, { isCurrent: true }).join(), /current season/);
  assert.match(seasonDocBlockers(null, { isCurrent: false }).join(), /does not exist/);
});

test("anything recorded on the season doc blocks, including unknown award keys", () => {
  const cases = [
    { gamesPlayed: 2 }, { endSeasonMode: true }, { record: { wins: 0, losses: 1, ties: 0 } },
    { "record.wins": 0 }, { recognitionLayouts: { p1: { order: [] } } },
    { finalAwards: { mvp: "p1" } }, { finalAwards: { surprise: "" } }, { finalAwards: "mvp" },
  ];
  for (const c of cases) assert.ok(seasonDocBlockers({ ...freshDraft, ...c }, { isCurrent: false }).length > 0, JSON.stringify(c));
});

test("roster entries block only when they carry stats, awards, or unrecognised data", () => {
  const entry = { id: "a", careerPlayerId: "a", identityStatus: "confirmed", name: "A", number: 1, shirtSize: null,
    leaderboardHidden: false, returningPlayer: true, linkedFrom: [], stats: { hits: 0, charlieHustleAwards: 0 } };
  assert.deepEqual(rosterBlockers([{ id: "a", data: entry }]), []);
  assert.match(rosterBlockers([{ id: "a", data: { ...entry, stats: { hits: 1 } } }]).join(), /recorded stats or awards/);
  assert.match(rosterBlockers([{ id: "a", data: { ...entry, stats: { mostImprovedAwards: 1 } } }]).join(), /recorded/);
  assert.match(rosterBlockers([{ id: "a", data: { ...entry, battingNotes: "x" } }]).join(), /unrecognised data/);
  assert.match(rosterBlockers([{ id: "a", data: { ...entry, stats: "lots" } }]).join(), /unrecognised stats/);
});

test("a season being deleted is a known status, read-only, and hidden from viewers", () => {
  assert.equal(asSeasonStatus("deleting"), "deleting");
  assert.equal(isWritable({ status: "deleting" }), false);
  assert.equal(visibleToViewers({ status: "deleting", isCurrent: false }), false);
  assert.equal(visibleToViewers({ status: "deleting", isCurrent: true }), false);
});
