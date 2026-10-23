// New Season Setup → Team step permissions (emulator, fixtures only).
//
// Reproduces the "Missing or insufficient permissions." failure: production's
// deployed rules predate teams (no /teams match) and deny the setup's team
// list and team creation. Then checks the repo's rules give the head
// coach exactly the access the setup needs, and nobody else any more.
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import { PROJECT_ID, admin, clearFirestore, clientDb, closeClients, expectDenied, getData, seed } from "./support.mjs";
import { createTeamIdempotent, listTeams, teamAccessMessage } from "../../src/lib/teamStore.ts";
import { LEGACY_TIGERS_BRANDING, newTeamTemplate } from "../../src/lib/branding.ts";
import { statsDigest } from "../../tools/identity/audit.mjs";
import { loadSnapshot, toJson } from "../../tools/identity/firestore.mjs";
import { COACH_UID, legacySnapshot } from "../support/fixtures.mjs";

const REPO_RULES = fs.readFileSync("firestore.rules", "utf8");
// Production's deployed ruleset (released 2026-08-16; read via the Rules
// API 2026-10-23, identical to firestore.rules at 09d0f60). It has no
// /teams match, so every team read and write is denied.
const DEPLOYED_RULES = fs.readFileSync("tests/support/deployed-2026-08-16.firestore.rules", "utf8");

async function loadRules(content) {
  const res = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}:securityRules`,
    { method: "PUT", body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }) },
  );
  if (!res.ok) throw new Error(`rules load failed: ${res.status}`);
}

// Exactly what the setup's Team step saves for each starting template.
const blankFalcons = () => ({
  ...newTeamTemplate(), teamId: "falcons-ab12", teamName: "Falcons", shortName: "FAL", sport: "softball", division: "10U",
});
const tigersLook = () => ({ ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "tigers-0001" });

let db;
beforeEach(async () => {
  await clearFirestore();
  await seed(legacySnapshot(), [COACH_UID]);
  db = clientDb(COACH_UID);
});
after(async () => {
  await loadRules(REPO_RULES);
  await closeClients();
});

async function tigersHistory() {
  const s = toJson(await loadSnapshot(admin));
  s.seasons = s.seasons.filter((x) => x.seasonId === "tigers-2026" || x.seasonId === "tigers-fall-2026");
  return statsDigest(s) + JSON.stringify(s.seasons.map((x) => [x.data, x.players])) + JSON.stringify(s.config);
}

test("reproduction: production's deployed rules deny the setup's team list and creation", async () => {
  assert.ok(!/match \/teams/.test(DEPLOYED_RULES), "deployed rules predate teams");
  await loadRules(DEPLOYED_RULES);
  try {
    const denials = [];
    for (const op of [() => listTeams(db), () => createTeamIdempotent(db, blankFalcons()), () => createTeamIdempotent(db, tigersLook())]) {
      const e = await op().then(() => null, (err) => err);
      assert.equal(e?.code, "permission-denied");
      denials.push(e);
    }
    // The coach sees an actionable explanation, not the SDK's generic text.
    for (const e of denials) {
      const text = teamAccessMessage(e, "fallback");
      assert.match(text, /security rules do not allow this account to read or save teams/);
      assert.doesNotMatch(text, /PERMISSION_DENIED|insufficient permissions|No matching allow/);
    }
    assert.equal(await getData("teams/falcons-ab12"), null);
  } finally {
    await loadRules(REPO_RULES);
  }
  // Same coach, same payloads, repo rules: allowed.
  assert.deepEqual(await listTeams(db), []);
  assert.equal(await createTeamIdempotent(db, blankFalcons()), "created");
});

test("head coach creates Blank→softball and Tigers-look→baseball teams once, and can list them", async () => {
  const before = await tigersHistory();
  const [a, b] = await Promise.all([createTeamIdempotent(db, blankFalcons()), createTeamIdempotent(db, blankFalcons())]);
  assert.deepEqual([a, b].sort(), ["created", "recovered"], "double submit makes one team");
  assert.equal(await createTeamIdempotent(db, tigersLook()), "created");
  assert.equal(await createTeamIdempotent(db, tigersLook()), "recovered");
  const teams = await listTeams(db);
  assert.deepEqual(teams.map((t) => [t.teamId, t.sport]), [["falcons-ab12", "softball"], ["tigers-0001", "baseball"]]);
  assert.deepEqual((await getData("teams/tigers-0001")).logo, { kind: "bundled", id: "tigers" });
  assert.equal(await tigersHistory(), before, "historical Tigers seasons and config unchanged");
});

test("non-coaches cannot create or modify teams; invalid payloads stay rejected", async () => {
  await createTeamIdempotent(db, blankFalcons());
  const T = (d, id) => doc(d, "teams", id);
  const valid = (id) => ({ ...blankFalcons(), teamId: id });

  for (const other of [clientDb("parent-not-admin"), clientDb(null)]) {
    await expectDenied(listTeams(other));
    await expectDenied(createTeamIdempotent(other, valid("sneaky-0001")));
    await expectDenied(updateDoc(T(other, "falcons-ab12"), { teamName: "Hacked" }));
  }
  // Ownership/identity metadata is not part of a team and cannot be added.
  await expectDenied(setDoc(T(db, "own-0001"), { ...valid("own-0001"), ownerUid: COACH_UID }));
  await expectDenied(setDoc(T(db, "own-0002"), { ...valid("own-0002"), createdByUid: "someone-else" }));
  await expectDenied(setDoc(T(db, "own-0003"), valid("not-own-0003")), "teamId must match the doc id");
  await expectDenied(updateDoc(T(db, "falcons-ab12"), { teamId: "renamed-0001" }));
  await expectDenied(updateDoc(T(db, "falcons-ab12"), { createdAt: new Date() }));
  for (const sport of ["cricket", "Softball", ""]) {
    await expectDenied(setDoc(T(db, "sport-0001"), { ...valid("sport-0001"), sport }));
  }
  await assert.rejects(createTeamIdempotent(db, { ...valid("sport-0002"), sport: "cricket" }));
  assert.equal((await getDoc(T(db, "falcons-ab12"))).data().teamName, "Falcons", "team unchanged");
});
