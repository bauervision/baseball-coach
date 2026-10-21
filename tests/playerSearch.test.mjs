import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCandidatesFromRosters,
  defaultSelectedKeys,
  editDistance,
  mergeRegistryCandidates,
  scoreName,
  searchCandidates,
  seasonVisibleToCoach,
} from "../src/lib/playerSearch.ts";
import {
  careerPlayerIdForEdit,
  normalizePersonName,
} from "../src/lib/playerIdentity.ts";
import {
  COACH_UID,
  IDS,
  OTHER_COACH_UID,
  legacySnapshot,
  rosterSeasons,
} from "./support/fixtures.mjs";

const names = (results) => results.map((r) => r.displayName);

test("player edits keep the permanent id; only legacy docs without one mint", () => {
  assert.deepEqual(careerPlayerIdForEdit(IDS.ava), {
    careerPlayerId: IDS.ava,
    minted: false,
  });
  const minted = careerPlayerIdForEdit(undefined);
  assert.equal(minted.minted, true);
  assert.match(minted.careerPlayerId, /^[0-9a-f-]{36}$/);
});

test("names normalize accents, case, and punctuation", () => {
  assert.equal(normalizePersonName("  José  O'Neil-Smith "), "jose oneil smith");
});

test("edit distance counts an adjacent swap as one edit", () => {
  assert.equal(editDistance("michael", "micheal"), 1);
  assert.equal(editDistance("smith", "smtih"), 1);
  assert.equal(editDistance("ava", "eva"), 1);
});

test("search matches partial names, typos, and ranks exact first", () => {
  assert.ok(scoreName("ava", "Ava Carter") > scoreName("av", "Ava Carter"));
  assert.ok(scoreName("car", "Ava Carter") > 0);
  assert.ok(scoreName("Jordna", "Jordan Kim") > 0, "transposed letters");
  assert.ok(scoreName("dian", "Ben Diaz") === 0 || scoreName("diaz", "Ben Diaz") > scoreName("dian", "Ben Diaz"));
  assert.equal(scoreName("ava xyz", "Ava Carter"), 0, "every query token must match");
  assert.equal(scoreName("bo", "Ava Carter"), 0, "two-letter tokens need a prefix match");
  assert.ok(scoreName("dna fox", "Dana Fox") > 0, "one typo in a three-letter token");
  assert.ok(scoreName("dana", "Dana Fox") > scoreName("dna", "Dana Fox"), "exact ranks above typo");

  const candidates = buildCandidatesFromRosters(rosterSeasons(legacySnapshot()), {
    uid: COACH_UID,
  });
  const res = searchCandidates(candidates, "dana fox");
  assert.equal(res[0].displayName, "Dana Fox");
});

test("unreviewed legacy entries are never grouped, even with a shared id or name", () => {
  const candidates = buildCandidatesFromRosters(rosterSeasons(legacySnapshot()), {
    uid: COACH_UID,
  });
  const ava = candidates.filter((c) => c.displayName === "Ava Carter");
  assert.equal(ava.length, 2, "Spring and Fall Ava stay separate until reviewed");
  assert.ok(ava.every((c) => c.status === "unreviewed" && c.seasons.length === 1));
});

test("confirmed entries sharing a permanent id are one candidate across teams", () => {
  const snap = legacySnapshot();
  for (const s of snap.seasons) {
    for (const p of s.players) p.data.identityStatus = "confirmed";
  }
  snap.seasons[1].data.teamName = "Broncos"; // different team, same child
  const candidates = buildCandidatesFromRosters(rosterSeasons(snap), { uid: COACH_UID });
  const ava = candidates.filter((c) => c.careerPlayerId === IDS.ava);
  assert.equal(ava.length, 1);
  assert.equal(ava[0].seasons.length, 2);
  assert.equal(ava[0].seasons[0].seasonLabel, "Fall 2026", "most recent first");
  assert.equal(ava[0].seasons[0].teamName, "Broncos");
});

test("same-named children stay separate and get disambiguation", () => {
  const candidates = buildCandidatesFromRosters(rosterSeasons(legacySnapshot()), {
    uid: COACH_UID,
  });
  const res = searchCandidates(candidates, "jordan kim");
  assert.equal(res.length, 2);
  assert.notEqual(res[0].careerPlayerId, res[1].careerPlayerId);
  assert.ok(res.every((r) => r.disambiguation));
  assert.notEqual(res[0].disambiguation, res[1].disambiguation);
  assert.match(res[0].disambiguation, /#10 · Tigers Fall 2026/, "recent season first");
});

test("renamed player is found by an earlier name", () => {
  const snap = legacySnapshot();
  for (const s of snap.seasons) for (const p of s.players) p.data.identityStatus = "confirmed";
  snap.seasons[1].players[0].data.name = "Ava Carter-Lopez";
  const candidates = buildCandidatesFromRosters(rosterSeasons(snap), { uid: COACH_UID });
  const res = searchCandidates(candidates, "ava carter");
  assert.equal(res[0].careerPlayerId, IDS.ava);
  assert.equal(res[0].displayName, "Ava Carter-Lopez", "shows current name");
});

test("coaches only see seasons they manage (legacy seasons belong to all admins)", () => {
  assert.equal(seasonVisibleToCoach({}, COACH_UID), true);
  assert.equal(seasonVisibleToCoach({ coachUids: [COACH_UID] }, COACH_UID), true);
  assert.equal(seasonVisibleToCoach({ coachUids: [OTHER_COACH_UID] }, COACH_UID), false);
  assert.equal(seasonVisibleToCoach({ coachUids: [OTHER_COACH_UID] }, ""), false);

  const snap = legacySnapshot();
  snap.seasons.push({
    seasonId: "hawks-2026",
    data: { teamName: "Hawks", seasonLabel: "Fall 2026", coachUids: [OTHER_COACH_UID] },
    players: [{ id: "x", data: { name: "Zoe Unrelated", number: 1, careerPlayerId: IDS.eli, identityStatus: "confirmed" } }],
  });
  const mine = buildCandidatesFromRosters(rosterSeasons(snap), { uid: COACH_UID });
  assert.ok(!names(mine).includes("Zoe Unrelated"));
  const theirs = buildCandidatesFromRosters(rosterSeasons(snap), { uid: OTHER_COACH_UID });
  assert.ok(names(theirs).includes("Zoe Unrelated"));
});

test("an imported player is one candidate: the explicit link folds in the legacy entry", () => {
  const snap = legacySnapshot();
  snap.seasons.push({
    seasonId: "broncos-spring-2027",
    data: { teamName: "Broncos", seasonLabel: "Spring 2027", coachUids: [COACH_UID] },
    players: [
      {
        id: IDS.ben,
        data: {
          name: "Ben Diaz",
          number: 2,
          careerPlayerId: IDS.ben,
          identityStatus: "confirmed",
          linkedFrom: [{ seasonId: "tigers-fall-2026", seasonPlayerId: "21-ben-diaz" }],
        },
      },
    ],
  });
  const ben = buildCandidatesFromRosters(rosterSeasons(snap), { uid: COACH_UID }).filter(
    (c) => c.displayName === "Ben Diaz",
  );
  // Broncos + linked Fall are one identity; unlinked Spring stays separate.
  assert.equal(ben.length, 2);
  const confirmed = ben.find((c) => c.status === "confirmed");
  assert.deepEqual(confirmed.seasons.map((s) => s.seasonLabel), ["Spring 2027", "Fall 2026"]);
  const legacy = ben.find((c) => c.status === "unreviewed");
  assert.deepEqual(legacy.seasons.map((s) => s.seasonLabel), ["Spring 2026"]);
});

test("the target season is excluded from candidates", () => {
  const candidates = buildCandidatesFromRosters(rosterSeasons(legacySnapshot()), {
    uid: COACH_UID,
    excludeSeasonId: "tigers-fall-2026",
  });
  assert.ok(candidates.every((c) => c.seasons.every((s) => s.seasonId === "tigers-2026")));
});

test("linked children are preselected by default but not when already on the roster", () => {
  const snap = legacySnapshot();
  for (const s of snap.seasons) for (const p of s.players) p.data.identityStatus = "confirmed";
  const childNew = "99999999-9999-4999-8999-999999999999";
  const merged = mergeRegistryCandidates(
    buildCandidatesFromRosters(rosterSeasons(snap), { uid: COACH_UID }),
    [
      { careerPlayerId: IDS.cole, displayName: "Cole Evans" },
      { careerPlayerId: childNew, displayName: "Riley Evans" },
    ],
    new Set([IDS.cole, childNew]),
  );
  const riley = merged.find((c) => c.careerPlayerId === childNew);
  assert.equal(riley.linkedChild, true);
  assert.equal(riley.seasons.length, 0, "a child who has not played yet still appears");

  // Brand-new team: nobody on the roster yet → both children preselected.
  const keys = defaultSelectedKeys(merged, () => false);
  assert.deepEqual(new Set(keys), new Set([`id:${IDS.cole}`, `id:${childNew}`]));

  // Cole already rostered → only Riley.
  assert.deepEqual(
    defaultSelectedKeys(merged, (c) => c.careerPlayerId === IDS.cole),
    [`id:${childNew}`],
  );

  // Linked children rank first on an empty query.
  const listed = searchCandidates(merged, "");
  assert.ok(listed.slice(0, 2).every((r) => r.linkedChild));
});
