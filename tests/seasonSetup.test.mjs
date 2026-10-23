import { test } from "node:test";
import assert from "node:assert/strict";

import {
  draftsForTeam,
  furthestStep,
  nextSeasonAfter,
  planSeason,
  proposeSeasonId,
  resolveStep,
  seasonLabelFor,
  setupHref,
  setupReadiness,
} from "../src/lib/seasonSetup.ts";
import { LEGACY_TIGERS_BRANDING, snapshotFromTeam } from "../src/lib/branding.ts";

const FALCONS = { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "falcons-ab12", teamName: "Falcons", division: "10U", sport: "softball", logo: null };

function season(over) {
  return {
    seasonId: "x", teamName: "Tigers", seasonLabel: "Fall 2026", gamesPlayed: 0, status: null,
    endSeasonMode: false, record: { wins: 0, losses: 0 }, finalAwardsChosen: 0, layoutsSaved: 0,
    lifecycleHistory: [], branding: null, ...over,
  };
}

test("season ids and labels are readable and derived from team, term, and year", () => {
  assert.equal(seasonLabelFor("Spring", 2027), "Spring 2027");
  assert.equal(proposeSeasonId("Falcons", "Spring", 2027), "falcons-spring-2027");
  assert.equal(proposeSeasonId("Lady Hawks 10U!", "Fall", 2027), "lady-hawks-10u-fall-2027");
  assert.deepEqual(nextSeasonAfter(new Date("2026-10-23T12:00:00")), { term: "Spring", year: 2027 });
  assert.deepEqual(nextSeasonAfter(new Date("2027-02-01T12:00:00")), { term: "Spring", year: 2027 });
  assert.deepEqual(nextSeasonAfter(new Date("2027-07-01T12:00:00")), { term: "Fall", year: 2027 });
});

test("planSeason creates new, resumes this team's draft, and refuses anything else", () => {
  const seasons = [
    season({ seasonId: "tigers-2026", seasonLabel: "Spring 2026" }),
    season({ seasonId: "tigers-fall-2026", seasonLabel: "Fall 2026" }),
  ];
  assert.deepEqual(planSeason(seasons, FALCONS, "Spring", 2027), {
    kind: "create",
    seasonId: "falcons-spring-2027",
    seasonLabel: "Spring 2027",
  });

  const draft = season({ seasonId: "falcons-spring-2027", seasonLabel: "Spring 2027", teamId: FALCONS.teamId, teamName: "Falcons", status: "draft" });
  assert.equal(planSeason([...seasons, draft], FALCONS, "Spring", 2027).kind, "resume");
  // A draft with the same label but another id is still the one to resume.
  const renamed = { ...draft, seasonId: "falcons-s27" };
  assert.equal(planSeason([...seasons, renamed], FALCONS, "Spring", 2027).season.seasonId, "falcons-s27");

  const active = { ...draft, status: "active" };
  const p1 = planSeason([...seasons, active], FALCONS, "Spring", 2027);
  assert.equal(p1.kind, "conflict");
  assert.match(p1.reason, /will not change it/);
  const otherTeam = season({ seasonId: "falcons-spring-2027", seasonLabel: "Spring 2027", teamId: "other", teamName: "Other" });
  const p2 = planSeason([...seasons, otherTeam], FALCONS, "Spring", 2027);
  assert.equal(p2.kind, "conflict", "never merged into an unrelated season");
  assert.match(p2.reason, /already used by Other/);
  assert.deepEqual(draftsForTeam([...seasons, draft, otherTeam], FALCONS.teamId).map((s) => s.seasonId), ["falcons-spring-2027"]);
});

test("readiness: team, season, valid team branding, ≥1 player, not finalized", () => {
  const snap = snapshotFromTeam(FALCONS);
  const s = season({ seasonId: "falcons-spring-2027", seasonLabel: "Spring 2027", teamId: FALCONS.teamId, status: "draft", branding: snap });
  assert.equal(setupReadiness({ team: FALCONS, season: s, branding: snap, rosterCount: 1 }).ready, true, "no lineup or game required");
  const empty = setupReadiness({ team: FALCONS, season: s, branding: snap, rosterCount: 0 });
  assert.equal(empty.ready, false);
  assert.deepEqual(empty.items.filter((i) => !i.ok).map((i) => i.key), ["roster"]);
  assert.equal(setupReadiness({ team: FALCONS, season: s, branding: null, rosterCount: 3 }).ready, false);
  assert.equal(setupReadiness({ team: FALCONS, season: s, branding: { ...snap, teamId: "other" }, rosterCount: 3 }).ready, false);
  assert.equal(setupReadiness({ team: FALCONS, season: { ...s, status: "finalized" }, branding: snap, rosterCount: 3 }).ready, false);
  assert.equal(setupReadiness({ team: null, season: null, branding: null, rosterCount: 0 }).ready, false);
});

test("steps follow persisted progress; a URL can't skip ahead", () => {
  assert.equal(furthestStep({ teamOk: false, seasonOk: false, rosterCount: 0 }), "team");
  assert.equal(furthestStep({ teamOk: true, seasonOk: false, rosterCount: 0 }), "season");
  assert.equal(furthestStep({ teamOk: true, seasonOk: true, rosterCount: 0 }), "roster");
  assert.equal(furthestStep({ teamOk: true, seasonOk: true, rosterCount: 2 }), "ready");
  assert.equal(resolveStep("ready", "season"), "season", "can't skip ahead");
  assert.equal(resolveStep("team", "ready"), "team", "completed steps stay revisitable");
  assert.equal(resolveStep("bogus", "ready"), "team");
  assert.equal(resolveStep(null, "roster"), "team");
  assert.equal(setupHref({ step: "roster", team: "falcons-ab12", season: "falcons-spring-2027" }), "/admin/?setup=1&step=roster&team=falcons-ab12&setupSeason=falcons-spring-2027");
  assert.equal(setupHref({ step: "team" }), "/admin/?setup=1&step=team");
});
