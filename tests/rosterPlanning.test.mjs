import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planRosterAdditions,
  rosterRemovalBlocker,
  validateNewSeasonId,
} from "../src/lib/rosterPlanning.ts";
import { computeRunnerUpAwards, computeTrophies } from "../src/lib/trophies.ts";
import { IDS, legacySnapshot } from "./support/fixtures.mjs";

const NEW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function pick(key, name, extra = {}) {
  return {
    careerPlayerId: IDS[key],
    name,
    linkedFrom: [{ seasonId: "tigers-fall-2026", seasonPlayerId: `x-${key}` }],
    number: "",
    primaryPos: "",
    shirtSize: "",
    ...extra,
  };
}

test("new season ids must be new, valid, and are compared case-insensitively", () => {
  const existing = ["tigers-2026", "tigers-fall-2026"];
  assert.equal(validateNewSeasonId("tigers-2026", existing).ok, false);
  assert.equal(validateNewSeasonId(" Tigers-2026 ", existing).ok, false);
  assert.equal(validateNewSeasonId("", existing).ok, false);
  assert.equal(validateNewSeasonId("tigers 2027!", existing).ok, false);
  assert.deepEqual(validateNewSeasonId("Broncos-Spring-2027", existing), {
    ok: true,
    seasonId: "broncos-spring-2027",
  });
});

test("imports use the permanent id as an opaque doc id and start at zero", () => {
  const plan = planRosterAdditions({
    existing: [],
    imports: [pick("ava", "Ava Carter", { number: "17", shirtSize: "ym", primaryPos: "SS" })],
    newPlayers: [],
  });
  assert.equal(plan.writes.length, 1);
  const w = plan.writes[0];
  assert.equal(w.seasonPlayerId, IDS.ava);
  assert.equal(w.data.careerPlayerId, IDS.ava);
  assert.equal(w.data.identityStatus, "confirmed");
  assert.equal(w.data.number, 17);
  assert.equal(w.data.shirtSize, "YM");
  assert.equal(w.data.primaryPos, "SS");
  assert.equal(w.data.returningPlayer, true);
  assert.deepEqual(w.data.linkedFrom, [{ seasonId: "tigers-fall-2026", seasonPlayerId: "x-ava" }]);
  assert.ok(Object.values(w.data.stats).every((v) => v === 0));
  assert.doesNotMatch(w.seasonPlayerId, /ava|17/i, "doc id encodes no name or number");
});

test("repeated imports are idempotent", () => {
  const imports = [pick("ava", "Ava Carter"), pick("ben", "Ben Diaz")];
  const first = planRosterAdditions({ existing: [], imports, newPlayers: [] });
  assert.equal(first.writes.length, 2);

  const existing = first.writes.map((w) => ({
    id: w.seasonPlayerId,
    name: w.data.name,
    number: w.data.number,
    careerPlayerId: w.data.careerPlayerId,
    linkedFrom: w.data.linkedFrom,
  }));
  const second = planRosterAdditions({ existing, imports, newPlayers: [] });
  assert.equal(second.writes.length, 0);
  assert.deepEqual(second.skipped.map((s) => s.reason), ["already-on-roster", "already-on-roster"]);

  const dup = planRosterAdditions({
    existing: [],
    imports: [pick("ava", "Ava Carter"), pick("ava", "Ava Carter")],
    newPlayers: [],
  });
  assert.equal(dup.writes.length, 1);
  assert.equal(dup.skipped[0].reason, "duplicate");
});

test("a legacy roster entry already imported is not imported twice", () => {
  const plan = planRosterAdditions({
    existing: [
      {
        id: "someone",
        name: "Ava Carter",
        number: 7,
        careerPlayerId: NEW_ID,
        linkedFrom: [{ seasonId: "tigers-fall-2026", seasonPlayerId: "x-ava" }],
      },
    ],
    imports: [pick("ava", "Ava Carter")],
    newPlayers: [],
  });
  assert.equal(plan.writes.length, 0);
});

test("legacy roster entries with old doc ids count as already on roster", () => {
  const plan = planRosterAdditions({
    existing: [{ id: "07-ava-carter", name: "Ava Carter", number: 7, careerPlayerId: IDS.ava }],
    imports: [pick("ava", "Ava Carter")],
    newPlayers: [],
  });
  assert.equal(plan.writes.length, 0);
});

test("same names are allowed, never merged, and flagged gently", () => {
  const plan = planRosterAdditions({
    existing: [{ id: "x", name: "Jordan Kim", number: 10, careerPlayerId: IDS.jordanB }],
    imports: [],
    newPlayers: [
      { careerPlayerId: NEW_ID, name: "Jordan  Kim", number: "10", primaryPos: "", shirtSize: "" },
    ],
  });
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.writes[0].data.returningPlayer, false);
  assert.equal(plan.writes[0].data.careerPlayerId, NEW_ID);
  assert.equal(plan.warnings.length, 2, "shared number + shared name");
});

test("a missing permanent id is an error, not a silent new identity", () => {
  assert.throws(() =>
    planRosterAdditions({
      existing: [],
      imports: [{ ...pick("ava", "Ava"), careerPlayerId: "" }],
      newPlayers: [],
    }),
  );
});

test("only players with no history at all can be removed", () => {
  const scan = {
    lineIds: ["a"],
    gameAwardIds: ["b"],
    finalAwardIds: ["c"],
    layoutIds: ["d"],
    linkedFromIds: ["e"],
  };
  assert.equal(rosterRemovalBlocker("a", scan), "has game stats");
  assert.equal(rosterRemovalBlocker("b", scan), "has game recognition");
  assert.equal(rosterRemovalBlocker("c", scan), "has a season award");
  assert.equal(rosterRemovalBlocker("d", scan), "has a saved recognition layout");
  assert.equal(rosterRemovalBlocker("e", scan), "is linked from a later season");
  assert.equal(rosterRemovalBlocker("z", scan), null);
});

test("identity fields do not change award calculations", () => {
  const snap = legacySnapshot();
  const season = snap.seasons[1];
  const toPlayer = (p, extra) => ({
    id: p.id,
    name: p.data.name,
    number: p.data.number,
    careerPlayerId: p.data.careerPlayerId,
    stats: p.data.stats,
    ...extra,
  });
  const opts = { endSeasonMode: true, finalAwards: season.data.finalAwards };
  const before = computeTrophies(season.players.map((p) => toPlayer(p, {})), opts);
  const after = computeTrophies(
    season.players.map((p) =>
      toPlayer(p, {
        identityStatus: "confirmed",
        linkedFrom: [{ seasonId: "tigers-2026", seasonPlayerId: p.id }],
      }),
    ),
    opts,
  );
  // Awards embed the player objects; compare everything except the new fields.
  const strip = (v) =>
    JSON.parse(
      JSON.stringify(v, (k, val) =>
        k === "identityStatus" || k === "linkedFrom" ? undefined : val,
      ),
    );
  assert.ok(before.length > 0);
  assert.deepEqual(strip(after), strip(before));
  assert.deepEqual(
    strip(computeRunnerUpAwards(after, "07-ava-carter")),
    strip(computeRunnerUpAwards(before, "07-ava-carter")),
  );
});
