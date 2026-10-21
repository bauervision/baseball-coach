import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateCareerStats,
  buildCareerHistoryRows,
  resolveCareerParticipations,
} from "../src/lib/careerHistory.ts";
import { planRosterAdditions } from "../src/lib/rosterPlanning.ts";
import { seasonSortKey } from "../src/lib/seasonOrder.ts";
import { IDS, legacySnapshot, participation, stats } from "./support/fixtures.mjs";

const RETURNING = [
  ["ava", "07-ava-carter", "07-ava-carter"],
  ["ben", "12-ben-diaz", "21-ben-diaz"],
  ["cole", "03-cole-evans", "03-cole-evans"],
  ["dana", "09-dana-fox", "09-dana-fox"],
];

function confirmAll(snap) {
  for (const s of snap.seasons) for (const p of s.players) p.data.identityStatus = "confirmed";
  return snap;
}

test("seasons sort by label: Spring before Fall, years ascending", () => {
  const keys = ["Fall 2026", "Spring 2027", "Spring 2026", "Fall 2027"].sort(
    (a, b) => seasonSortKey(a) - seasonSortKey(b),
  );
  assert.deepEqual(keys, ["Spring 2026", "Fall 2026", "Spring 2027", "Fall 2027"]);
});

test("four returning players keep both seasons once their links are confirmed", () => {
  const snap = confirmAll(legacySnapshot());
  for (const [key, springId, fallId] of RETURNING) {
    const subject = participation(snap, "tigers-fall-2026", fallId);
    const spring = participation(snap, "tigers-2026", springId);
    const included = resolveCareerParticipations(subject, [spring]);
    assert.deepEqual(
      included.map((p) => p.season.seasonLabel),
      ["Spring 2026", "Fall 2026"],
      key,
    );
    const totals = aggregateCareerStats(included);
    assert.equal(totals.hits, spring.stats.hits + subject.stats.hits, key);
    assert.equal(totals.games, spring.stats.games + subject.stats.games, key);
  }
});

test("unreviewed name-matched links do not count toward career", () => {
  const snap = legacySnapshot(); // no identityStatus anywhere
  const subject = participation(snap, "tigers-fall-2026", "07-ava-carter");
  const spring = participation(snap, "tigers-2026", "07-ava-carter");
  assert.equal(subject.careerPlayerId, spring.careerPlayerId);
  const included = resolveCareerParticipations(subject, [spring]);
  assert.deepEqual(included, [subject]);
});

test("different children with the same name never merge", () => {
  const snap = confirmAll(legacySnapshot());
  const a = participation(snap, "tigers-2026", "08-jordan-kim");
  const b = participation(snap, "tigers-fall-2026", "10-jordan-kim");
  assert.equal(a.name, b.name);
  // Even if a loader handed over the other Jordan, ids differ → excluded.
  const included = resolveCareerParticipations(b, [a]);
  assert.deepEqual(included.map((p) => p.seasonPlayerId), ["10-jordan-kim"]);
  assert.equal(aggregateCareerStats(included).hits, b.stats.hits);
});

test("Spring 2027 import on a new team: new number, zero season stats, career kept", () => {
  const snap = legacySnapshot();
  // Coach imports the Fall entries (explicit picks) into a new Bronco team.
  const plan = planRosterAdditions({
    existing: [],
    imports: RETURNING.map(([key, , fallId]) => ({
      careerPlayerId: IDS[key],
      name: participation(snap, "tigers-fall-2026", fallId).name,
      linkedFrom: [{ seasonId: "tigers-fall-2026", seasonPlayerId: fallId }],
      number: "4" + key.length, // new jersey numbers
      primaryPos: "",
      shirtSize: "YL",
    })),
    newPlayers: [],
  });
  assert.equal(plan.writes.length, 4);

  for (const [key, , fallId] of RETURNING) {
    const w = plan.writes.find((x) => x.data.careerPlayerId === IDS[key]);
    assert.equal(w.data.stats.hits, 0, "new season starts at zero");
    assert.equal(w.data.stats.games, 0);
    const subject = {
      seasonId: "broncos-spring-2027",
      seasonPlayerId: w.seasonPlayerId,
      ...w.data,
      season: { teamName: "Broncos", seasonLabel: "Spring 2027" },
    };
    const fall = participation(snap, "tigers-fall-2026", fallId);
    const spring = participation(snap, "tigers-2026", RETURNING.find((r) => r[0] === key)[1]);
    const included = resolveCareerParticipations(subject, [fall, spring]);

    // Fall is linked explicitly; unreviewed Spring stays out until approved.
    assert.deepEqual(
      included.map((p) => p.season.seasonLabel),
      ["Fall 2026", "Spring 2027"],
      key,
    );
    assert.equal(aggregateCareerStats(included).hits, fall.stats.hits, key);

    // After the coach approves the Spring link (migration), all three count.
    const springConfirmed = { ...spring, identityStatus: "confirmed" };
    const fallConfirmed = { ...fall, identityStatus: "confirmed" };
    const all = resolveCareerParticipations(subject, [fallConfirmed, springConfirmed]);
    assert.equal(all.length, 3, key);
    assert.equal(
      aggregateCareerStats(all).hits,
      fall.stats.hits + spring.stats.hits,
      `${key}: career totals unchanged by the new zeroed season`,
    );
    const rows = buildCareerHistoryRows(all);
    assert.deepEqual(rows.map((r) => r.teamName), ["Tigers", "Tigers", "Broncos"]);
    assert.equal(rows[2].number, w.data.number, "new jersey number shown for 2027");
    assert.equal(rows[1].number, fall.number, "historical number kept");
  }
});

test("an unreviewed entry referenced by a confirmed entry is part of the career", () => {
  const snap = legacySnapshot();
  const fall = participation(snap, "tigers-fall-2026", "07-ava-carter");
  const next = {
    seasonId: "tigers-spring-2027",
    seasonPlayerId: IDS.ava,
    careerPlayerId: IDS.ava,
    identityStatus: "confirmed",
    linkedFrom: [{ seasonId: "tigers-fall-2026", seasonPlayerId: "07-ava-carter" }],
    name: "Ava Carter",
    number: 7,
    stats: stats({ games: 2, hits: 1 }),
    season: { teamName: "Tigers", seasonLabel: "Spring 2027" },
  };
  // Viewing the Fall page later still shows the linked career.
  const fromFall = resolveCareerParticipations(fall, [next]);
  assert.deepEqual(fromFall.map((p) => p.season.seasonLabel), ["Fall 2026", "Spring 2027"]);
});

test("linkedFrom pointing at another identity is ignored", () => {
  const snap = legacySnapshot();
  const wrong = participation(snap, "tigers-fall-2026", "11-finn-hale");
  const subject = {
    ...participation(snap, "tigers-fall-2026", "07-ava-carter"),
    seasonId: "x-2027",
    seasonPlayerId: IDS.ava,
    identityStatus: "confirmed",
    linkedFrom: [{ seasonId: "tigers-fall-2026", seasonPlayerId: "11-finn-hale" }],
    season: { teamName: "Tigers", seasonLabel: "Spring 2027" },
  };
  const included = resolveCareerParticipations(subject, [wrong]);
  assert.deepEqual(included.map((p) => p.seasonPlayerId), [IDS.ava]);
});

test("career streaks: longest is the best season, current does not carry", () => {
  const totals = aggregateCareerStats([
    { stats: stats({ longestHitStreak: 4, currentHitStreak: 4 }) },
    { stats: stats({ longestHitStreak: 2, currentHitStreak: 1 }) },
  ]);
  assert.equal(totals.longestHitStreak, 4);
  assert.equal(totals.currentHitStreak, 0);
});

test("history rows show only positive season recognition", () => {
  const snap = confirmAll(legacySnapshot());
  const rows = buildCareerHistoryRows([
    participation(snap, "tigers-2026", "07-ava-carter"),
    participation(snap, "tigers-fall-2026", "07-ava-carter"),
  ]);
  assert.deepEqual(rows[0].recognition, ["MVP", "1 coach pick"]);
  assert.deepEqual(rows[1].recognition, ["Best Attitude"]);
});
