// Tallies migration (Checkpoint D1): planning, idempotency, conflicts,
// malformed and broken inputs, ownership, verification, and the production
// guard — pure, on the representative legacy fixture. The emulator suite
// (tests/emulator/talliesMigration.test.mjs) runs the same tool for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  LEDGER_PATH,
  PLAYER_PRIVATE,
  SEASON_PRIVATE,
  buildPlan,
  canonical,
  chunkOps,
  classify,
  cloneState,
  desiredState,
  seasonPlayerDocId,
  simulateApply,
  targetDigest,
} from "../tools/tallies-migration/model.mjs";
import { inventory } from "../tools/tallies-migration/inventory.mjs";
import { verifyMigration } from "../tools/tallies-migration/verify.mjs";
import { EnvironmentError, assertEmulatorEnvironment } from "../tools/tallies-migration/emulator.mjs";
import { LEGACY_TIGERS_BRANDING } from "../src/lib/branding.ts";
import { seasonPlayerDocId as appSeasonPlayerDocId } from "../src/lib/teamData.ts";
import { FALCONS, FALCONS_DRAFT, FALL, OWNER, SPRING, WORKSPACE, legacyState } from "./support/talliesMigrationFixture.mjs";
import { PS_IDS } from "./support/productionShapedFixture.mjs";

const OPTS = { ownerUid: OWNER };
const plan = (state, opts = OPTS) => buildPlan(state, opts);
const codes = (p) => p.blockers.map((b) => b.code);
const migrate = (state = legacyState(), opts = OPTS) => {
  const p = plan(state, opts);
  assert.deepEqual(p.blockers, []);
  return { p, after: simulateApply(state, p.ops).state };
};
/** The ledger an apply writes first (what makes the legacy team id stick). */
const withLedger = (state, p) => {
  const s = cloneState(state);
  s.set(LEDGER_PATH, { ownerUid: p.ownerUid, legacyTeamId: p.legacyTeamId, legacySeasonIds: p.legacySeasonIds, adoptedTeam: p.adoptedTeam, state: "complete" });
  return s;
};

test("clean plan: Tigers team bootstrap, seasons, publication, current season, privacy, re-keying", () => {
  const p = plan(legacyState());
  assert.deepEqual(p.blockers, []);
  assert.match(p.legacyTeamId, /^t_[0-9a-f]{20}$/, "opaque team id");
  assert.deepEqual(p.legacySeasonIds, [SPRING, FALL]);
  const team = p.ops.find((o) => o.path === `teams/${p.legacyTeamId}`);
  assert.equal(team.action, "create");
  for (const k of ["teamName", "shortName", "sport", "division", "logo", "palettes", "awardCollection"]) {
    assert.deepEqual(team.after[k], LEGACY_TIGERS_BRANDING[k], `Tigers ${k} preserved`);
  }
  assert.equal(team.after.ownerUid, OWNER);
  assert.equal(team.after.workspaceId, WORKSPACE);
  assert.equal(team.after.currentSeasonId, FALL, "current season from the legacy setting");
  const seasons = Object.fromEntries(p.seasons.map((s) => [s.seasonId, s]));
  assert.equal(seasons[SPRING].published, true);
  assert.equal(seasons[FALL].published, true);
  assert.equal(seasons[FALCONS_DRAFT].published, false, "Falcons draft stays unpublished");
  assert.equal(seasons[SPRING].status, "finalized");
  assert.equal(seasons[FALL].current, true);
  assert.equal(seasons[SPRING].current, false);
  // Nothing touches records, the legacy setting, or the allowlist.
  for (const o of p.ops) {
    assert.doesNotMatch(o.path, /\/(games|lines|lineups)\//, o.path);
    assert.ok(!["app/config", `admins/${OWNER}`].includes(o.path), o.path);
  }
  // Re-keying only the identity-keyed draft entries, to the app's own ids.
  assert.equal(p.idMap.length, 3);
  for (const r of p.idMap) {
    assert.equal(r.seasonId, FALCONS_DRAFT);
    assert.match(r.to, /^sp_[0-9a-f]{20}$/);
  }
  assert.ok(p.idMap.some((r) => r.from === PS_IDS.alex && r.to === seasonPlayerDocId(PS_IDS.alex, FALCONS_DRAFT)));
});

test("plans are deterministic and byte-stable for an unchanged source", () => {
  const a = plan(legacyState());
  const b = plan(legacyState());
  assert.equal(a.planHash, b.planHash);
  assert.equal(canonical(a), canonical(b));
  // A different set of legacy seasons gives a different (still opaque) id.
  const s = legacyState();
  s.delete(`seasons/${SPRING}`);
  for (const k of [...s.keys()]) if (k.startsWith(`seasons/${SPRING}/`)) s.delete(k);
  assert.notEqual(plan(s, { ...OPTS, acceptNoCurrent: true }).legacyTeamId, a.legacyTeamId);
});

test("the opaque roster id matches the app's, and the legacy branding is valid as-is", async () => {
  assert.equal(seasonPlayerDocId(PS_IDS.alex, FALCONS_DRAFT), await appSeasonPlayerDocId(PS_IDS.alex, FALCONS_DRAFT));
  const p = plan(legacyState());
  assert.ok(!p.blockers.some((b) => b.code === "legacy-branding-invalid"));
});

test("applied plan reconciles; re-plan is empty with the same end state", () => {
  const src = legacyState();
  const { p, after } = migrate(src);
  const report = verifyMigration(src, withLedger(after, p), OPTS);
  assert.ok(report.ok, JSON.stringify(report.checks.filter((c) => !c.ok), null, 1));
  const again = plan(withLedger(after, p));
  assert.deepEqual(again.blockers, []);
  assert.equal(again.ops.length, 0, "nothing left to do");
  assert.equal(again.targetDigest, p.targetDigest);
});

test("finalized Spring 2026 is preserved: status, timestamps, stats; audit moved privately", () => {
  const src = legacyState();
  const { p, after } = migrate(src);
  const before = src.get(`seasons/${SPRING}`);
  const now = after.get(`seasons/${SPRING}`);
  assert.equal(now.status, "finalized");
  assert.deepEqual(now.finalizedAt, before.finalizedAt);
  for (const k of SEASON_PRIVATE) assert.ok(!(k in now), `${k} not public`);
  const audit = after.get(`seasons/${SPRING}/private/audit`);
  assert.deepEqual(audit.lifecycleHistory, before.lifecycleHistory);
  assert.equal(audit.finalizedByUid, OWNER);
  // Only ownership/publication/privacy fields change on the finalized doc.
  const changed = p.ops.find((o) => o.path === `seasons/${SPRING}`);
  assert.deepEqual(Object.keys(changed.after).sort(), ["finalizedByUid", "lifecycleHistory", "ownerUid", "published", "teamId"]);
  for (const [path, d] of src) if (path.startsWith(`seasons/${SPRING}/games`) || path.startsWith(`seasons/${SPRING}/lineups`)) assert.deepEqual(after.get(path), d, path);
});

test("Falcons draft stays an unpublished draft; identity moves private; public ids are opaque", () => {
  const { p, after } = migrate();
  const d = after.get(`seasons/${FALCONS_DRAFT}`);
  assert.equal(d.status, "draft");
  assert.equal(d.published, false);
  assert.equal(d.teamId, FALCONS);
  assert.ok(!("coachUids" in d));
  assert.deepEqual(after.get(`seasons/${FALCONS_DRAFT}/private/audit`).coachUids, [OWNER]);
  const falcons = after.get(`teams/${FALCONS}`);
  assert.equal(falcons.ownerUid, OWNER);
  assert.equal(falcons.workspaceId, WORKSPACE);
  assert.ok(!("currentSeasonId" in falcons), "a draft is never current");
  assert.equal(after.get(`publicTeams/${FALCONS}`).currentSeasonId, null);
  for (const r of p.idMap) {
    assert.equal(after.has(`seasons/${FALCONS_DRAFT}/players/${r.from}`), false);
    const pub = after.get(`seasons/${FALCONS_DRAFT}/players/${r.to}`);
    const priv = after.get(`seasons/${FALCONS_DRAFT}/players/${r.to}/private/profile`);
    assert.equal(pub.id, r.to);
    assert.equal(priv.careerPlayerId, r.from);
    assert.ok(!canonical(pub).includes(r.from), "public doc never holds the permanent id");
  }
});

test("public documents hold no private fields; career links reach only published seasons", () => {
  const { after } = migrate();
  let links = 0;
  for (const [p, d] of after) {
    if (/^seasons\/[^/]+\/players\/[^/]+$/.test(p)) {
      for (const k of PLAYER_PRIVATE) assert.ok(!(k in d), `${p}.${k}`);
      for (const l of d.careerLinks ?? []) {
        links++;
        assert.notEqual(l.seasonId, FALCONS_DRAFT, `${p} links to the draft`);
      }
    }
    if (/^publicTeams\//.test(p)) assert.deepEqual(Object.keys(d).sort(), ["awardCollection", "currentSeasonId", "division", "logo", "palettes", "shortName", "sport", "teamName", "updatedAt"]);
  }
  assert.ok(links >= 8, "returning Tigers keep their career links");
  // Spring ↔ Fall for a returning player.
  const alexFall = after.get(`seasons/${FALL}/players/21-alex-rivera`);
  assert.deepEqual(alexFall.careerLinks, [{ seasonId: SPRING, seasonPlayerId: "p01" }]);
  // The draft's entries link to Tigers seasons privately-derived, publicly safe.
  const tigers = [...after].find(([p]) => /^publicTeams\/t_/.test(p))[1];
  assert.equal(tigers.currentSeasonId, FALL);
});

test("interruption at any point resumes to the identical end state", () => {
  const src = legacyState();
  const p = plan(src);
  const full = simulateApply(src, p.ops).state;
  // Cut after every transaction unit apply can commit (one unit per
  // transaction), with small units so every boundary is exercised.
  const units = chunkOps(p.ops, 4);
  for (let u = 0, cut = 0; u <= units.length; cut += units[u]?.length ?? 0, u++) {
    const partial = withLedger(simulateApply(src, p.ops.slice(0, cut)).state, p);
    assert.deepEqual(partial.missingParents, [], `unit ${u}: no orphaned documents`);
    const re = plan(partial);
    assert.deepEqual(re.blockers, [], `cut ${cut}: ${JSON.stringify(re.blockers)}`);
    assert.equal(re.targetDigest, p.targetDigest, `cut ${cut}: same end state`);
    // The original plan also resumes: done ops are "unchanged", never conflicts.
    const resumedOriginal = simulateApply(partial, p.ops);
    assert.equal(resumedOriginal.counts.conflict, 0);
    const finished = simulateApply(partial, re.ops).state;
    finished.delete(LEDGER_PATH);
    assert.equal(canonical([...finished].sort()), canonical([...full].sort()), `cut ${cut}`);
  }
});

test("conflicting destination documents are detected, never overwritten", () => {
  // A private profile already holding a different shirt size.
  const a = legacyState();
  a.set(`seasons/${FALL}/players/21-alex-rivera/private/profile`, { shirtSize: "AXL" });
  assert.ok(codes(plan(a)).includes("conflict-private-profile"));
  // A public projection that disagrees with the team.
  const b = legacyState();
  b.set(`publicTeams/${FALCONS}`, { teamName: "Hawks", shortName: "", sport: "baseball", division: "", logo: null, palettes: {}, awardCollection: "original", currentSeasonId: null });
  assert.ok(codes(plan(b)).includes("conflict-public-team"));
  // A pre-existing team at the legacy id with other colors.
  const c = legacyState();
  const id = plan(c).legacyTeamId;
  c.set(`teams/${id}`, { teamId: id, teamName: "Tigers", shortName: "", sport: "baseball", division: "Mustang", logo: null, palettes: LEGACY_TIGERS_BRANDING.palettes, awardCollection: "original" });
  assert.ok(codes(plan(c)).includes("conflict-team"));
  // A re-key target that differs.
  const d = legacyState();
  d.set(`seasons/${FALCONS_DRAFT}/players/${seasonPlayerDocId(PS_IDS.alex, FALCONS_DRAFT)}`, { id: "x", name: "Someone Else" });
  assert.ok(codes(plan(d)).includes("conflict-rekey-target"));
  // Per-document classification at apply time.
  const op = { path: "seasons/x", action: "update", before: { published: { __absent: true } }, after: { published: true } };
  assert.equal(classify(op, {}), "apply");
  assert.equal(classify(op, { published: true }), "unchanged");
  assert.equal(classify(op, { published: false }), "conflict");
  assert.equal(classify({ path: "t/x", action: "create", after: { a: 1 } }, { a: 2 }), "conflict");
  assert.equal(classify({ path: "t/x", action: "delete", before: { a: 1 } }, { a: 2 }), "conflict");
});

test("a source change after planning changes the end state (apply refuses)", () => {
  const src = legacyState();
  const p = plan(src);
  const changed = cloneState(src);
  const line = [...changed.keys()].find((k) => k.includes(`${FALL}/games/`) && k.includes("/lines/"));
  changed.set(line, { ...changed.get(line), delta: { ...changed.get(line).delta, hits: 99 } });
  assert.notEqual(targetDigest(desiredState(changed, OPTS).desired), p.targetDigest);
});

test("missing and malformed legacy fields: warned, blocked, or preserved as they are", () => {
  const src = legacyState();
  const p = plan(src);
  assert.ok(p.warnings.some((w) => w.code === "missing-season-labels" && w.path === `seasons/${SPRING}`));
  // Quirks survive: dotted record fields, 31-key stats, game without type.
  const { after } = migrate(src);
  assert.ok("record.wins" in after.get(`seasons/${SPRING}`));
  const bad = legacyState();
  bad.set(`seasons/${FALL}`, { ...bad.get(`seasons/${FALL}`), status: "archived" });
  assert.ok(codes(plan(bad)).includes("invalid-status"));
  const unknown = legacyState();
  unknown.set(`seasons/${FALL}/notes/n1`, { text: "x" });
  assert.ok(codes(plan(unknown)).includes("unknown-season-data"));
  const missing = legacyState();
  missing.missingParents = [`seasons/ghost`];
  assert.ok(codes(plan(missing)).includes("missing-parent"));
  const noConfig = legacyState();
  noConfig.delete("app/config");
  const nc = plan(noConfig);
  assert.deepEqual(nc.blockers, []);
  assert.ok(nc.warnings.some((w) => w.code === "config-missing"));
  assert.ok(!("currentSeasonId" in nc.ops.find((o) => o.path === `teams/${nc.legacyTeamId}`).after));
  const malformed = legacyState();
  const pp = `seasons/${FALL}/players/03-morgan-ellis`;
  malformed.set(pp, { ...malformed.get(pp), number: "3", stats: { ...malformed.get(pp).stats, hits: "two" } });
  const inv = inventory(malformed);
  assert.ok(inv.malformed.some((m) => m.path === pp && m.field === "number"));
  assert.ok(inv.malformed.some((m) => m.path === pp && m.field === "stats.hits"));
});

test("invalid ownership mapping blocks the plan", () => {
  assert.ok(codes(plan(legacyState(), {})).includes("owner-missing"));
  assert.ok(codes(plan(legacyState(), { ownerUid: "someone-else" })).includes("owner-not-admin"));
  const two = legacyState();
  two.set("admins/second", { enabled: true });
  assert.ok(codes(plan(two)).includes("owner-ambiguous"));
  assert.ok(codes(plan(legacyState({ bound: false }))).includes("owner-not-bound"));
  const ws = legacyState();
  ws.set(`coachWorkspaces/${WORKSPACE}`, { ownerUid: "other", status: "active" });
  assert.ok(codes(plan(ws)).includes("owner-workspace-invalid"));
  const foreign = legacyState();
  foreign.set(`seasons/${FALL}`, { ...foreign.get(`seasons/${FALL}`), ownerUid: "coach-other" });
  assert.ok(codes(plan(foreign)).includes("foreign-owner"));
  const foreignTeam = legacyState();
  foreignTeam.set(`teams/${FALCONS}`, { ...foreignTeam.get(`teams/${FALCONS}`), ownerUid: "coach-other" });
  assert.ok(codes(plan(foreignTeam)).includes("foreign-owner"));
});

test("broken historical references: structural ones block, record ones are reported and preserved", () => {
  const team = legacyState();
  team.set(`seasons/${FALCONS_DRAFT}`, { ...team.get(`seasons/${FALCONS_DRAFT}`), teamId: "gone-team", branding: undefined });
  team.get(`seasons/${FALCONS_DRAFT}`).branding = { ...team.get(`teams/${FALCONS}`), teamId: "gone-team" };
  assert.ok(codes(plan(team)).includes("broken-team-reference"));
  const cfg = legacyState();
  cfg.set("app/config", { currentSeasonId: "tigers-1999" });
  assert.ok(codes(plan(cfg)).includes("config-current-missing"));
  const award = legacyState();
  award.set(`seasons/${SPRING}`, { ...award.get(`seasons/${SPRING}`), finalAwards: { ...award.get(`seasons/${SPRING}`).finalAwards, bestAttitude: "p99" } });
  const inv = inventory(award);
  assert.ok(inv.dangling.some((d) => d.field === "finalAwards.bestAttitude" && d.target === "p99"));
  const { p, after } = migrate(award);
  assert.equal(after.get(`seasons/${SPRING}`).finalAwards.bestAttitude, "p99", "preserved exactly");
  assert.ok(verifyMigration(award, withLedger(after, p), OPTS).ok);
});

test("an existing Tigers team is never duplicated; it can be adopted explicitly", () => {
  const s = legacyState();
  const b = structuredClone(LEGACY_TIGERS_BRANDING);
  s.set("teams/tigers-x1", { ...b, teamId: "tigers-x1", createdAt: { __timestamp: "2026-10-01T00:00:00.000Z" }, updatedAt: { __timestamp: "2026-10-01T00:00:00.000Z" } });
  assert.ok(codes(plan(s)).includes("legacy-team-exists"));
  const adopted = plan(s, { ...OPTS, legacyTeamId: "tigers-x1" });
  assert.deepEqual(adopted.blockers, []);
  assert.equal(adopted.legacyTeamId, "tigers-x1");
  assert.ok(!adopted.ops.some((o) => o.path.startsWith("teams/t_")), "no second team");
  const after = simulateApply(s, adopted.ops).state;
  assert.equal(after.get(`seasons/${FALL}`).teamId, "tigers-x1");
});

test("a legacy current season that cannot be current blocks unless explicitly accepted", () => {
  const s = legacyState();
  s.set("app/config", { currentSeasonId: SPRING }); // finalized
  assert.ok(codes(plan(s)).includes("config-current-ineligible"));
  const ok = plan(s, { ...OPTS, acceptNoCurrent: true });
  assert.deepEqual(ok.blockers, []);
  assert.ok(!("currentSeasonId" in ok.ops.find((o) => o.path === `teams/${ok.legacyTeamId}`).after));
});

test("verification detects intentional corruption", () => {
  const src = legacyState();
  const { p, after } = migrate(src);
  const base = withLedger(after, p);
  assert.ok(verifyMigration(src, base, OPTS).ok);
  const fall = (id) => `seasons/${FALL}/players/${id}`;
  const line = [...base.keys()].find((k) => k.includes(`${FALL}/games/`) && k.includes("/lines/"));
  const game = [...base.keys()].find((k) => /^seasons\/tigers-fall-2026\/games\/[^/]+$/.test(k));
  const corruptions = {
    stats: (s) => s.set(fall("03-morgan-ellis"), { ...s.get(fall("03-morgan-ellis")), stats: { ...s.get(fall("03-morgan-ellis")).stats, hits: 999 } }),
    "stats/line": (s) => s.set(line, { ...s.get(line), delta: { ...s.get(line).delta, rbi: 7 } }),
    games: (s) => s.set(game, { ...s.get(game), result: s.get(game).result === "W" ? "L" : "W" }),
    lineups: (s) => {
      const l = s.get(`seasons/${FALL}/lineups/current`);
      s.set(`seasons/${FALL}/lineups/current`, { ...l, rows: l.rows.slice(1) });
    },
    awards: (s) => s.set(`seasons/${SPRING}`, { ...s.get(`seasons/${SPRING}`), finalAwards: { ...s.get(`seasons/${SPRING}`).finalAwards, mvp: "p02" } }),
    privacy: (s) => s.set(fall("05-nico-vance"), { ...s.get(fall("05-nico-vance")), shirtSize: "YM" }),
    "career-links": (s) => s.set(fall("05-nico-vance"), { ...s.get(fall("05-nico-vance")), careerLinks: [{ seasonId: FALCONS_DRAFT, seasonPlayerId: "sp_00000000000000000000" }] }),
    "public-projection": (s) => {
      const id = [...s.keys()].find((k) => /^publicTeams\/t_/.test(k));
      s.set(id, { ...s.get(id), palettes: { ...s.get(id).palettes, dark: { ...s.get(id).palettes.dark, primary: "#000000" } } });
    },
    "season-states": (s) => s.set(`seasons/${SPRING}`, { ...s.get(`seasons/${SPRING}`), status: "active" }),
    publication: (s) => s.set(`seasons/${FALCONS_DRAFT}`, { ...s.get(`seasons/${FALCONS_DRAFT}`), published: true }),
    "current-season": (s) => s.set("app/config", { ...s.get("app/config"), currentSeasonId: SPRING }),
    ownership: (s) => s.set(`seasons/${FALL}`, { ...s.get(`seasons/${FALL}`), ownerUid: "coach-other" }),
    rosters: (s) => s.delete(fall("30-rowan-fisk")),
    "team-branding": (s) => {
      const id = [...s.keys()].find((k) => /^teams\/t_/.test(k));
      s.set(id, { ...s.get(id), logo: null });
    },
  };
  for (const [label, corrupt] of Object.entries(corruptions)) {
    const check = label.split("/")[0];
    const s = cloneState(base);
    corrupt(s);
    const r = verifyMigration(src, s, OPTS);
    assert.equal(r.ok, false, `${label} corruption not detected`);
    assert.ok(r.checks.find((c) => c.id === check)?.ok === false, `${check}: failing checks ${r.checks.filter((c) => !c.ok).map((c) => c.id)}`);
  }
  // An unmigrated database does not pass either.
  assert.equal(verifyMigration(src, src, OPTS).ok, false);
});

test("inventory reports states, counts, and private fields without changing the source", () => {
  const src = legacyState();
  const before = canonical([...src]);
  const inv = inventory(src);
  assert.equal(canonical([...src]), before);
  const by = Object.fromEntries(inv.seasons.map((s) => [s.seasonId, s]));
  assert.equal(by[SPRING].status, "finalized");
  assert.equal(by[SPRING].legacy, true);
  assert.equal(by[SPRING].legacyDottedRecord, true);
  assert.equal(by[FALCONS_DRAFT].players.idShapes["identity-keyed"], 3);
  assert.equal(by[FALL].players.privateFieldsPublic, 11);
  assert.deepEqual(by[FALCONS_DRAFT].privateFieldsOnSeason, ["coachUids"]);
  assert.equal(inv.legacyCurrentSeason, FALL);
  assert.equal(inv.counts["seasons/*/games/*/lines/*"] > 0, true);
});

test("production execution is refused: the environment must be a verified local emulator", () => {
  const ok = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085" };
  assert.deepEqual(assertEmulatorEnvironment(ok, "demo-baseball-coach"), { host: "127.0.0.1", port: 8085, projectId: "demo-baseball-coach" });
  const refuse = (env, project, re) => assert.throws(() => assertEmulatorEnvironment(env, project), (e) => e instanceof EnvironmentError && re.test(e.message));
  refuse({}, "demo-baseball-coach", /not set/);
  refuse({ FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" }, "demo-baseball-coach", /loopback/);
  refuse({ FIRESTORE_EMULATOR_HOST: "10.0.0.5:8085" }, "demo-baseball-coach", /loopback/);
  refuse({ FIRESTORE_EMULATOR_HOST: "127.0.0.1" }, "demo-baseball-coach", /host:port/);
  refuse(ok, "baseball-coach-997ab", /not a demo- project/);
  refuse(ok, undefined, /--project/);
  refuse({ ...ok, GCLOUD_PROJECT: "baseball-coach-997ab" }, "demo-baseball-coach", /conflicts/);
  refuse({ ...ok, GOOGLE_CLOUD_PROJECT: "baseball-coach-997ab" }, "demo-baseball-coach", /conflicts/);
  refuse({ ...ok, GOOGLE_APPLICATION_CREDENTIALS: "C:/keys/x.json" }, "demo-baseball-coach", /CREDENTIALS/);
});

test("no production path exists in the migration tool (source guard)", () => {
  const files = ["tools/tallies-migrate.mjs", ...fs.readdirSync("tools/tallies-migration").map((f) => `tools/tallies-migration/${f}`)];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(src, /--allow-production|allowProduction|applicationDefault|credential\s*:|cert\(|service-account/i, f);
    assert.doesNotMatch(src, /import\s*\{[^}]*\bconnect\b[^}]*\}\s*from\s*"\.\.?\/identity\/firestore\.mjs"/, `${f} must not use the shared connector (it has a production flag)`);
    assert.doesNotMatch(src, /"app",\s*"config"|doc\("app\/config"\)\.(set|update)/, `${f} never writes app/config`);
  }
  for (const f of ["model.mjs", "verify.mjs", "inventory.mjs"]) {
    assert.doesNotMatch(fs.readFileSync(`tools/tallies-migration/${f}`, "utf8"), /firebase-admin|firebase\//, `${f} is pure`);
  }
  const em = fs.readFileSync("tools/tallies-migration/emulator.mjs", "utf8");
  assert.equal((em.match(/initializeApp\(/g) ?? []).length, 1, "one connector");
  assert.match(em, /openEmulatorDatabase[\s\S]*assertEmulatorEnvironment[\s\S]*probeEmulator[\s\S]*initializeApp/);
});
