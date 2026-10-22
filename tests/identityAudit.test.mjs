import { test } from "node:test";
import assert from "node:assert/strict";

import {
  approvalTemplate,
  auditIdentities,
  identityNeutralDigest,
  planMigration,
  statsDigest,
} from "../tools/identity/audit.mjs";
import { IDS, legacySnapshot } from "./support/fixtures.mjs";

const NEW = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const audit = (snap) => auditIdentities(snap, { mintId: () => NEW });

test("audit identifies the four returning players as pending proposals", () => {
  const report = audit(legacySnapshot());
  const returning = report.returningPlayers.map((r) => r.displayName).sort();
  assert.deepEqual(returning.filter((n) => n !== "Jordan Kim"), [
    "Ava Carter",
    "Ben Diaz",
    "Cole Evans",
    "Dana Fox",
  ]);
  const shared = report.proposals.filter((p) => p.basis === "shared-career-id");
  assert.equal(shared.length, 4);
  const ben = shared.find((p) => p.displayName === "Ben Diaz");
  assert.equal(ben.careerPlayerId, IDS.ben);
  assert.deepEqual(ben.members.map((m) => m.number).sort(), [12, 21]);
});

test("same-name children with different ids are a possible duplicate, not a link", () => {
  const report = audit(legacySnapshot());
  const jordan = report.proposals.find((p) => p.displayName === "Jordan Kim");
  assert.equal(jordan.basis, "same-name-different-ids");
  assert.equal(report.possibleDuplicates.length, 1);
  const template = approvalTemplate(report, "t");
  assert.ok(template.approvals.every((a) => a.decision === "pending"));
});

test("audit reports conflicts, missing ids, and orphaned game lines", () => {
  const snap = legacySnapshot();
  snap.seasons[0].players.push({
    id: "02-max-hall",
    data: { name: "Max Hall", number: 2, careerPlayerId: IDS.finn },
  });
  snap.seasons[1].players.push({ id: "15-no-id", data: { name: "Noa Id", number: 15 } });
  const report = audit(snap);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].kind, "different-names-share-id");
  assert.ok(!report.proposals.some((p) => p.careerPlayerId === IDS.finn));
  assert.deepEqual(report.missingCareerId.map((m) => m.seasonPlayerId), ["15-no-id"]);
  assert.deepEqual(report.orphanLines.map((o) => o.playerId), ["12-ben-diaz"]);
});

test("migration applies only approved proposals and is idempotent", () => {
  const snap = legacySnapshot();
  const report = audit(snap);
  const approvals = approvalTemplate(report, "t");

  assert.equal(planMigration(snap, approvals).ops.length, 0, "pending = nothing");

  const ava = approvals.approvals.find((a) => a.displayName === "Ava Carter");
  ava.decision = "approve";
  const plan = planMigration(snap, approvals);
  assert.ok(plan.ok);
  assert.equal(plan.ops.length, 2);
  for (const op of plan.ops) {
    assert.deepEqual(op.set, { careerPlayerId: IDS.ava, identityStatus: "confirmed" });
    assert.equal(op.previous.identityStatus, null);
    assert.ok(!("stats" in op.set));
  }

  // Apply to the snapshot and re-plan: nothing left to do.
  for (const op of plan.ops) {
    const [, seasonId, , playerId] = op.path.split("/");
    const p = snap.seasons.find((s) => s.seasonId === seasonId).players.find((x) => x.id === playerId);
    Object.assign(p.data, op.set);
  }
  const again = planMigration(snap, approvals);
  assert.equal(again.ops.length, 0);
  assert.equal(again.noops.length, 2);
});

test("migration refuses impossible approvals", () => {
  const snap = legacySnapshot();
  const bad = {
    approvals: [
      {
        proposalId: "p1",
        decision: "approve",
        careerPlayerId: IDS.ava,
        members: [
          { seasonId: "tigers-2026", seasonPlayerId: "07-ava-carter" },
          { seasonId: "tigers-2026", seasonPlayerId: "12-ben-diaz" },
        ],
      },
      {
        proposalId: "p2",
        decision: "approve",
        careerPlayerId: "not-a-uuid",
        members: [{ seasonId: "tigers-2026", seasonPlayerId: "07-ava-carter" }],
      },
      {
        proposalId: "p3",
        decision: "approve",
        careerPlayerId: IDS.cole,
        members: [{ seasonId: "tigers-2026", seasonPlayerId: "missing" }],
      },
    ],
  };
  const plan = planMigration(snap, bad);
  assert.equal(plan.ok, false);
  assert.ok(plan.errors.some((e) => e.includes("two members in season")));
  assert.ok(plan.errors.some((e) => e.includes("UUID")));
  assert.ok(plan.errors.some((e) => e.includes("does not exist")));
});

test("stats digest changes only when stats or game lines change", () => {
  const a = legacySnapshot();
  const b = legacySnapshot();
  b.seasons[0].players[0].data.identityStatus = "confirmed";
  assert.equal(statsDigest(a), statsDigest(b));
  b.seasons[0].players[0].data.stats.hits += 1;
  assert.notEqual(statsDigest(a), statsDigest(b));
});

test("identity-neutral digest ignores only identity fields on roster docs", () => {
  const tree = () => ({
    seasons: [
      {
        id: "s1",
        exists: true,
        data: { finalAwards: { mvp: "p1" }, recognitionLayouts: { p1: { order: ["a"] } } },
        collections: {
          players: [{ id: "p1", exists: true, data: { name: "A", careerPlayerId: "x", stats: { hits: 1 } }, collections: {} }],
        },
      },
    ],
  });
  const a = tree();
  const b = tree();
  b.seasons[0].collections.players[0].data.identityStatus = "confirmed";
  b.seasons[0].collections.players[0].data.careerPlayerId = "y";
  assert.equal(identityNeutralDigest(a), identityNeutralDigest(b));

  const c = tree();
  c.seasons[0].data.finalAwards.mvp = "p2";
  assert.notEqual(identityNeutralDigest(a), identityNeutralDigest(c), "awards change detected");
  const d = tree();
  d.seasons[0].data.recognitionLayouts.p1.order = ["b"];
  assert.notEqual(identityNeutralDigest(a), identityNeutralDigest(d), "layout change detected");
  const e = tree();
  e.seasons[0].collections.players[0].data.name = "B";
  assert.notEqual(identityNeutralDigest(a), identityNeutralDigest(e), "other roster fields detected");
});
