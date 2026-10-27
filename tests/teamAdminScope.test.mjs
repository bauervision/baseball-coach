// Team-scoped Admin (Tallies Checkpoint B+): pure helpers and source guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { adminHref, assertSeasonInTeam, requireTeam, ScopeError } from "../src/lib/adminScope.ts";
import { newOpaqueSeasonId, newOpaqueTeamId, seasonPlayerDocId, splitPlayerFields } from "../src/lib/teamData.ts";

const team = { teamId: "t_0123456789abcdef0123", teamName: "Comets", workspaceId: "ws", currentSeasonId: null };
const scope = { uid: "coach-1", workspaceId: "ws", team, seasonIds: new Set(["s1"]), refresh() {} };

test("ids are opaque: never a name, uid, or email", () => {
  assert.match(newOpaqueTeamId(), /^t_[0-9a-f]{20}$/);
  assert.match(newOpaqueSeasonId(), /^s_[0-9a-f]{20}$/);
  assert.notEqual(newOpaqueTeamId(), newOpaqueTeamId());
});

test("public roster doc ids are stable per season but never reveal or link the identity", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const a = await seasonPlayerDocId(id, "s_a");
  assert.equal(a, await seasonPlayerDocId(id, "s_a"), "stable: a repeated import finds the same doc");
  assert.notEqual(a, await seasonPlayerDocId(id, "s_b"), "not linkable across seasons");
  assert.match(a, /^sp_[0-9a-f]{20}$/);
  assert.ok(!a.includes("1111"));
});

test("private roster fields are split out of the public entry", () => {
  const { pub, priv } = splitPlayerFields({ id: "sp_x", name: "Ava", number: 7, stats: {}, shirtSize: "YM", careerPlayerId: "c", identityStatus: "confirmed", linkedFrom: [], returningPlayer: false });
  assert.deepEqual(Object.keys(pub).sort(), ["id", "name", "number", "returningPlayer", "stats"]);
  assert.deepEqual(Object.keys(priv).sort(), ["careerPlayerId", "identityStatus", "linkedFrom", "shirtSize"]);
});

test("a season must belong to the selected team and coach; no team, no writes", () => {
  assert.doesNotThrow(() => assertSeasonInTeam(scope, "s1", { teamId: team.teamId, ownerUid: "coach-1" }));
  assert.throws(() => assertSeasonInTeam(scope, "s2", { teamId: "t_other", ownerUid: "coach-1" }), ScopeError);
  assert.throws(() => assertSeasonInTeam(scope, "s3", { teamId: team.teamId, ownerUid: "coach-2" }), ScopeError);
  assert.throws(() => assertSeasonInTeam(scope, "s4", null), ScopeError);
  assert.throws(() => requireTeam({ ...scope, team: null }), /Choose a team/);
});

test("Admin URLs keep the selected team", () => {
  assert.equal(adminHref(null), "/admin/");
  assert.equal(adminHref(scope), "/admin/?team=t_0123456789abcdef0123");
  assert.equal(adminHref(scope, "tab=lineup"), "/admin/?team=t_0123456789abcdef0123&tab=lineup");
  assert.equal(adminHref({ ...scope, team: null }, "setup=1"), "/admin/?setup=1");
});

test("season labels hide opaque ids but keep legacy ids visible", () => {
  const src = fs.readFileSync("src/app/(protected)/admin/_parts/SeasonTab.tsx", "utf8");
  assert.ok(src.includes("if (/^s_[0-9a-f]{20}$/.test(s.seasonId)) return `${s.teamName} · ${s.seasonLabel}`;"));
  assert.ok(src.includes("return `${s.teamName} · ${s.seasonLabel} (${s.seasonId})`;"), "legacy label unchanged");
});

test("Tallies workflows never read or write app/config", () => {
  for (const f of ["src/lib/teamData.ts", "src/lib/teamPublication.ts", "src/lib/adminScope.ts", "src/components/auth/TeamWorkspace.tsx"]) {
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), /"app",\s*"config"|app\/config"/, f);
  }
  // Inside a team the Admin never falls back to the legacy default season.
  assert.match(fs.readFileSync("src/app/(protected)/admin/AdminClient.tsx", "utf8"), /if \(scope && !scope\.team\?\.currentSeasonId\) return <TeamWithoutSeason \/>/);
});
