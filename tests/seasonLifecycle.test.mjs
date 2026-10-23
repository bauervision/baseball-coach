import { test } from "node:test";
import assert from "node:assert/strict";

import {
  asSeasonStatus,
  finalizationChecklist,
  isFinalized,
  isLifecycleOnlyUpdate,
  planFinalize,
  planReopen,
  seasonTag,
  visibleToViewers,
} from "../src/lib/seasonLifecycle.ts";
import { withSeason } from "../src/lib/seasonHref.ts";
import { seasonSortKey } from "../src/lib/seasonOrder.ts";

const NOW = "2026-10-23T12:00:00.000Z";

test("legacy seasons (no status) are open, even when their old end-of-season flag is set", () => {
  const legacy = { endSeasonMode: true, finalAwards: { mvp: "p1" } };
  assert.equal(asSeasonStatus(legacy.status), null);
  assert.equal(isFinalized(legacy), false);
  assert.equal(seasonTag({ status: null, isCurrent: false, endSeasonMode: true }), "Ended");
  assert.equal(seasonTag({ status: null, isCurrent: true, endSeasonMode: true }), "Current");
  assert.equal(asSeasonStatus("closed"), null, "unknown values are not trusted");
});

test("tags: finalized wins over current; drafts hidden from viewers unless current", () => {
  assert.equal(seasonTag({ status: "finalized", isCurrent: true }), "Final");
  assert.equal(seasonTag({ status: "draft", isCurrent: false }), "Draft");
  assert.equal(seasonTag({ status: "active", isCurrent: false }), null);
  assert.equal(visibleToViewers({ status: "draft", isCurrent: false }), false);
  assert.equal(visibleToViewers({ status: "draft", isCurrent: true }), true);
  assert.equal(visibleToViewers({ status: "finalized", isCurrent: false }), true);
  assert.equal(visibleToViewers({ status: null, isCurrent: false }), true);
});

test("finalization writes only lifecycle fields, appends history, and is idempotent", () => {
  const season = {
    status: undefined,
    record: { wins: 3, losses: 6, ties: 1 },
    gamesPlayed: 10,
    finalAwards: { mvp: "09-x" },
    lifecycleHistory: [],
  };
  const plan = planFinalize(season, "coach-1", NOW);
  assert.equal(plan.alreadyFinalized, false);
  assert.deepEqual(plan.event, { action: "finalized", at: NOW, byUid: "coach-1", fromStatus: "legacy" });
  assert.equal(plan.history.length, 1);
  // The admin action writes exactly these keys; rules mirror the list.
  assert.ok(isLifecycleOnlyUpdate(["status", "finalizedAt", "finalizedByUid", "lifecycleHistory", "updatedAt"]));
  assert.ok(!isLifecycleOnlyUpdate(["status", "record"]));
  assert.ok(!isLifecycleOnlyUpdate(["gamesPlayed"]));

  const finalized = { ...season, status: "finalized", lifecycleHistory: plan.history };
  assert.deepEqual(planFinalize(finalized, "coach-1", NOW), { alreadyFinalized: true });
  assert.throws(() => planFinalize(season, "", NOW), /head coach/);
});

test("reopen keeps the previous finalization in an append-only audit", () => {
  const prior = { action: "finalized", at: "2026-10-01T00:00:00.000Z", byUid: "coach-1", fromStatus: "active" };
  const finalized = {
    status: "finalized",
    finalizedAt: { toDate: () => new Date("2026-10-01T00:00:00.000Z") },
    finalizedByUid: "coach-1",
    lifecycleHistory: [prior],
  };
  const plan = planReopen(finalized, "coach-1", NOW);
  assert.deepEqual(plan.history[0], prior, "earlier entries untouched");
  assert.deepEqual(plan.event, {
    action: "reopened",
    at: NOW,
    byUid: "coach-1",
    fromStatus: "finalized",
    previousFinalizedAt: "2026-10-01T00:00:00.000Z",
    previousFinalizedByUid: "coach-1",
  });
  assert.throws(() => planReopen({ status: "active" }, "coach-1", NOW), /Only a finalized season/);
  assert.throws(() => planReopen(finalized, "", NOW), /head coach/);
});

test("checklist shows each item with its season fact", () => {
  const items = finalizationChecklist({
    seasonLabel: "Fall 2026",
    teamName: "Tigers",
    officialGames: 10,
    record: { wins: 3, losses: 6, ties: 1 },
    rosterSize: 11,
    finalAwardsChosen: 0,
    layoutsSaved: 8,
  });
  assert.deepEqual(items.map((i) => i.key), ["games", "roster", "awards", "layouts", "identity"]);
  assert.equal(items[0].fact, "10 official games · 3-6-1");
  assert.equal(items[2].fact, "none chosen", "skipping awards is explicit");
  assert.equal(items[4].fact, "Tigers · Fall 2026");
});

test("viewed-season URLs: set, replace, drop for the active season, keep other params", () => {
  assert.equal(withSeason("/", "tigers-2026"), "/?season=tigers-2026");
  assert.equal(withSeason("/player?id=07-a", "tigers-2026"), "/player?id=07-a&season=tigers-2026");
  assert.equal(
    withSeason("/player?id=07-a&season=tigers-2026", "tigers-fall-2026", "tigers-fall-2026"),
    "/player?id=07-a",
    "viewing the active season needs no parameter",
  );
  assert.equal(withSeason("/trophies?season=x", null), "/trophies");
  assert.equal(withSeason("/p?id=1#sheet", "s1"), "/p?id=1&season=s1#sheet");
});

test("legacy Spring 2026 (label from normalized defaults) sorts before Fall 2026", () => {
  assert.ok(seasonSortKey("Spring 2026") < seasonSortKey("Fall 2026"));
  assert.ok(seasonSortKey("Fall 2026") < seasonSortKey("Spring 2027"));
});
