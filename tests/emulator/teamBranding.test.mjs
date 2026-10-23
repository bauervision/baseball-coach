// Team identities and season branding snapshots against this repo's
// firestore.rules (emulator, fixtures only).
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

import { admin, clearFirestore, clientDb, closeClients, expectDenied, getData, seed } from "./support.mjs";
import {
  addPlayersToRoster,
  createSeason,
  finalizeSeason,
} from "../../src/app/(protected)/admin/_parts/adminActions.ts";
import { applyTeamBrandingToSeason, createTeam, listTeams, updateTeam } from "../../src/lib/teamStore.ts";
import { LEGACY_TIGERS_BRANDING, normalizeBranding, snapshotFromTeam } from "../../src/lib/branding.ts";
import { DARK_TOKENS, LIGHT_TOKENS } from "../../src/lib/themeTokens.ts";
import { loadCareerSummary } from "../../src/lib/playerCareerStats.ts";
import { statsDigest } from "../../tools/identity/audit.mjs";
import { loadSnapshot, toJson } from "../../tools/identity/firestore.mjs";
import { COACH_UID, IDS, legacySnapshot } from "../support/fixtures.mjs";

const PARENT = "parent-not-admin";
const FALCONS = {
  teamId: "falcons-ab12",
  teamName: "Falcons",
  shortName: "FAL",
  sport: "softball",
  division: "10U",
  logo: null,
  palettes: {
    dark: { ...DARK_TOKENS, primary: "#2563eb", secondary: "#14b8a6", bgBase: "#07131f", card: "#0f2233" },
    light: { ...LIGHT_TOKENS, primary: "#1d4ed8", secondary: "#0f766e", bgBase: "#f4fbff" },
  },
  awardCollection: "original",
};
const NEXT = "falcons-spring-2027";

let db;
beforeEach(async () => {
  await clearFirestore();
  await seed(legacySnapshot(), [COACH_UID]);
  db = clientDb(COACH_UID);
});
after(closeClients);

async function tigersDigest() {
  const s = toJson(await loadSnapshot(admin));
  s.seasons = s.seasons.filter((x) => x.seasonId.startsWith("tigers"));
  return statsDigest(s) + JSON.stringify(s.seasons.map((x) => x.data));
}

function createNext(team = FALCONS) {
  return createSeason({
    db, uid: COACH_UID, seasonId: NEXT, existingSeasonIds: [], teamName: "", teamId: "",
    seasonLabel: "Spring 2027", usesGamesPlayedRecord: false, scheduledGames: 12, fallbackTeamName: "Team", team,
  });
}

test("head coach creates and edits a team; others cannot read or write it", async () => {
  const before = await tigersDigest();
  await createTeam(db, FALCONS);
  const stored = await getData(`teams/${FALCONS.teamId}`);
  assert.equal(stored.sport, "softball");
  assert.deepEqual(stored.palettes.dark, FALCONS.palettes.dark);
  assert.deepEqual(stored.palettes.light, FALCONS.palettes.light);
  assert.ok(stored.createdAt && stored.updatedAt);
  assert.deepEqual((await listTeams(db)).map((t) => t.teamId), [FALCONS.teamId]);

  await updateTeam(db, { ...FALCONS, division: "12U", palettes: { ...FALCONS.palettes, light: { ...FALCONS.palettes.light, card: "#f0f9ff" } } });
  const edited = await getData(`teams/${FALCONS.teamId}`);
  assert.equal(edited.division, "12U");
  assert.equal(edited.palettes.light.card, "#f0f9ff");
  assert.deepEqual(edited.palettes.dark, FALCONS.palettes.dark, "dark palette unchanged by a light edit");
  await assert.rejects(createTeam(db, FALCONS), /already exists/);

  for (const other of [clientDb(PARENT), clientDb(null)]) {
    await expectDenied(getDoc(doc(other, "teams", FALCONS.teamId)));
    await expectDenied(setDoc(doc(other, "teams", "sneaky-0000"), { ...FALCONS, teamId: "sneaky-0000" }));
    await expectDenied(updateDoc(doc(other, "teams", FALCONS.teamId), { teamName: "Hacked" }));
  }
  await expectDenied(deleteDoc(doc(db, "teams", FALCONS.teamId)));
  assert.equal(await tigersDigest(), before, "creating a team never touches Tigers seasons");
});

test("rules reject unsupported sports, unsafe assets, and malformed teams", async () => {
  const T = (id) => doc(db, "teams", id);
  const base = { ...FALCONS, teamId: "x-0001" };
  await expectDenied(setDoc(T("x-0001"), { ...base, sport: "basketball" }));
  await expectDenied(setDoc(T("x-0001"), { ...base, logo: { kind: "bundled", id: "dla" } }));
  await expectDenied(setDoc(T("x-0001"), { ...base, logo: { kind: "url", id: "https://evil.example/x.png" } }));
  await expectDenied(setDoc(T("x-0001"), { ...base, awardCollection: "cyberball" }));
  await expectDenied(setDoc(T("x-0001"), { ...base, palettes: { ...base.palettes, dark: { ...base.palettes.dark, primary: "url(https://evil)" } } }));
  await expectDenied(setDoc(T("x-0001"), { ...base, palettes: { ...base.palettes, light: { ...base.palettes.light, extra: "#fff" } } }));
  await expectDenied(setDoc(T("x-0001"), { ...base, teamId: "other-id" }));
  await expectDenied(setDoc(T("x-0001"), { ...base, teamName: "" }));
  await expectDenied(setDoc(T("x-0001"), { ...base, adminNote: "x" }));
  await setDoc(T("x-0001"), base);
  await expectDenied(updateDoc(T("x-0001"), { teamId: "renamed" }));
  await expectDenied(updateDoc(T("x-0001"), { sport: "football" }));
});

test("new seasons snapshot branding; later team edits never change them", async () => {
  await createTeam(db, FALCONS);
  await createNext();
  const season = await getData(`seasons/${NEXT}`);
  assert.equal(season.teamId, FALCONS.teamId);
  assert.equal(season.teamName, "Falcons");
  assert.equal(season.league, "10U");
  assert.deepEqual(season.branding, snapshotFromTeam(FALCONS));

  await updateTeam(db, { ...FALCONS, palettes: { ...FALCONS.palettes, dark: { ...FALCONS.palettes.dark, primary: "#dc2626" } } });
  const after = await getData(`seasons/${NEXT}`);
  assert.equal(after.branding.palettes.dark.primary, "#2563eb", "snapshot unchanged by the team edit");
  assert.deepEqual(normalizeBranding(after.branding).palettes.dark, FALCONS.palettes.dark);

  // Ordinary edits cannot overwrite the snapshot.
  await expectDenied(updateDoc(doc(db, "seasons", NEXT), { "branding.palettes.dark.primary": "#000000" }));
  await expectDenied(updateDoc(doc(db, "seasons", NEXT), { branding: { ...after.branding, teamName: "Other" }, scheduledGames: 3 }));
  // A season snapshot must match the season's team.
  await expectDenied(setDoc(doc(db, "seasons", "mismatch-2027"), { teamName: "X", seasonLabel: "Y", status: "draft", teamId: "nope", branding: snapshotFromTeam(FALCONS) }));
  await expectDenied(setDoc(doc(db, "seasons", "bad-2027"), { teamName: "X", seasonLabel: "Y", status: "draft", teamId: FALCONS.teamId, branding: { ...snapshotFromTeam(FALCONS), sport: "soccer" } }));
});

test("explicitly applying team branding works for open seasons only", async () => {
  await createTeam(db, FALCONS);
  await createNext();
  const red = { ...FALCONS, palettes: { ...FALCONS.palettes, dark: { ...FALCONS.palettes.dark, primary: "#dc2626" } } };
  await updateTeam(db, red);
  await applyTeamBrandingToSeason({ db, seasonId: NEXT, team: red });
  assert.equal((await getData(`seasons/${NEXT}`)).branding.palettes.dark.primary, "#dc2626");

  // Legacy Tigers seasons can be finalized; their (absent) snapshot then stays absent.
  await finalizeSeason({ db, uid: COACH_UID, seasonId: "tigers-2026" });
  await assert.rejects(applyTeamBrandingToSeason({ db, seasonId: "tigers-2026", team: red }), /finalized/);
  await expectDenied(
    updateDoc(doc(db, "seasons", "tigers-2026"), { teamId: red.teamId, teamName: red.teamName, league: "", branding: snapshotFromTeam(red) }),
  );
  assert.equal((await getData("seasons/tigers-2026")).branding, undefined);

  await finalizeSeason({ db, uid: COACH_UID, seasonId: NEXT });
  await assert.rejects(applyTeamBrandingToSeason({ db, seasonId: NEXT, team: FALCONS }), /finalized/);
  assert.equal((await getData(`seasons/${NEXT}`)).branding.palettes.dark.primary, "#dc2626", "finalized snapshot preserved");
});

test("legacy seasons keep the original Tigers branding; identities carry across teams", async () => {
  const before = await tigersDigest();
  assert.equal((await getData("seasons/tigers-fall-2026")).branding, undefined, "legacy season: no snapshot");
  assert.deepEqual(normalizeBranding(undefined) ?? LEGACY_TIGERS_BRANDING, LEGACY_TIGERS_BRANDING);

  await createTeam(db, FALCONS);
  await createNext();
  await addPlayersToRoster({
    db, seasonId: NEXT,
    imports: [{ careerPlayerId: IDS.ava, name: "Ava Carter", linkedFrom: [{ seasonId: "tigers-fall-2026", seasonPlayerId: "07-ava-carter" }], number: "3", primaryPos: "", shirtSize: "" }],
    newPlayers: [],
  });
  const ava = await getData(`seasons/${NEXT}/players/${IDS.ava}`);
  assert.equal(ava.careerPlayerId, IDS.ava, "same permanent identity on the new team");
  const career = await loadCareerSummary({
    db: clientDb(null), seasonId: NEXT, player: { id: IDS.ava, ...ava },
    currentSeason: { teamName: "Falcons", seasonLabel: "Spring 2027" },
  });
  assert.deepEqual(career.history.map((h) => `${h.teamName} ${h.seasonLabel}`), ["Tigers Fall 2026", "Falcons Spring 2027"]);
  assert.equal(await tigersDigest(), before, "Tigers seasons unchanged");
});
