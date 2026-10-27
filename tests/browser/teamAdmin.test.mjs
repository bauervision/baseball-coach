// Tallies Checkpoint B+: the full Admin inside a coach's selected team,
// driven through the real screens (emulator build, production guard,
// TARGET rules). Google sign-in uses the emulator-only test credential seam
// — NOT production OAuth. Skipped without BROWSER_BASE_URL.
//
// O  onboarding: empty workspace → team (Team Designer) → season → roster
//    → make current → publish → parents see it (1366)
// R  roster, stats, lineup, final awards, recognition sheet in the team (1440)
// S  one coach, two teams: switching mid-save writes only the first team;
//    foreign/invalid ids → Team not found; no Tigers fallback (1366)
// V  viewports: team Admin at 1366/1440/390/360 without horizontal overflow
// T  the legacy Tigers Admin (flags off) is unchanged (1366)
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { assertNoExternalRequests, launchGuardedBrowser } from "./support/guard.mjs";
import { productionShapedSnapshot } from "../support/productionShapedFixture.mjs";
import { LEGACY_TIGERS_BRANDING } from "../../src/lib/branding.ts";
import { applyOps, planSplit, readState } from "../../tools/privacy-split-migrate.mjs";

const BASE = process.env.BROWSER_BASE_URL;
const SKIP = !BASE && "set BROWSER_BASE_URL";
const SHOTS = process.env.BC_SCREENSHOT_DIR;
const PROJECT = "demo-baseball-coach";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const TARGET = fs.readFileSync("firestore.target.rules", "utf8");
const REPO = fs.readFileSync("firestore.rules", "utf8");

const OWNER = { uid: "coach-mike", email: "coach@example.test" };
const NEWBIE = "first.team@gmail.com";
const TIGERS = "tigers-0001";
const FALCONS = "falcons-0002";
const SPRING = "tigers-2026";
const FALL = "tigers-fall-2026";
const F_FALL = "falcons-fall-2026";
const V = {
  1366: { width: 1366, height: 768 },
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
  360: { width: 360, height: 780 },
};

let browser, db, auth;

async function loadRules(content) {
  const res = await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: "PUT",
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }),
  });
  if (!res.ok) throw new Error(`rules load failed: ${res.status}`);
}

const team = (teamId, ownerUid, workspaceId, extra = {}) => ({
  ...structuredClone(LEGACY_TIGERS_BRANDING), teamId, ownerUid, workspaceId, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), ...extra,
});
const projection = (t, currentSeasonId) => ({
  teamName: t.teamName, shortName: t.shortName, sport: t.sport, division: t.division, logo: t.logo ?? null,
  palettes: t.palettes, awardCollection: t.awardCollection, currentSeasonId, updatedAt: new Date(),
});
const FALCONS_PALETTES = structuredClone(LEGACY_TIGERS_BRANDING.palettes);
FALCONS_PALETTES.dark.primary = "#2563eb";
FALCONS_PALETTES.light.primary = "#1d4ed8";

before(async () => {
  if (!BASE) return;
  process.env.FIRESTORE_EMULATOR_HOST = FS_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
  db = getFirestore();
  auth = getAuth();
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  await auth.createUser({ uid: OWNER.uid, email: OWNER.email, password: "fixture-pass-123" });

  const snap = productionShapedSnapshot({ migrated: true });
  const tigers = team(TIGERS, OWNER.uid, "ws_original", { currentSeasonId: FALL });
  const falcons = team(FALCONS, OWNER.uid, "ws_original", { teamName: "Falcons", shortName: "FAL", division: "10U", palettes: FALCONS_PALETTES, logo: null, currentSeasonId: F_FALL });
  const batch = db.batch();
  batch.set(db.doc(`admins/${OWNER.uid}`), snap.admins);
  batch.set(db.doc("app/config"), snap.config);
  for (const s of snap.seasons) {
    const sref = db.doc(`seasons/${s.seasonId}`);
    batch.set(sref, { ...s.data, ownerUid: OWNER.uid, teamId: TIGERS, published: true, status: s.seasonId === SPRING ? "finalized" : "active" });
    for (const p of s.players) batch.set(sref.collection("players").doc(p.id), p.data);
    for (const g of s.games) {
      const gref = sref.collection("games").doc(g.id);
      batch.set(gref, g.data);
      for (const l of g.lines) batch.set(gref.collection("lines").doc(l.id), l.data);
    }
    for (const l of s.lineups) batch.set(sref.collection("lineups").doc(l.id), l.data);
  }
  const fBrand = { teamId: FALCONS, teamName: "Falcons", shortName: "FAL", sport: "baseball", division: "10U", logo: null, palettes: FALCONS_PALETTES, awardCollection: "original" };
  batch.set(db.doc(`seasons/${F_FALL}`), { teamId: FALCONS, ownerUid: OWNER.uid, teamName: "Falcons", seasonLabel: "Fall 2026", league: "10U", status: "active", published: false, gamesPlayed: 0, scheduledGames: 8, record: { wins: 0, losses: 0, ties: 0 }, branding: fBrand, createdAt: new Date("2026-08-01") });
  batch.set(db.doc(`seasons/${F_FALL}/players/f1`), { id: "f1", name: "Frankie Falcon", number: 9, stats: {} });
  batch.set(db.doc(`seasons/${F_FALL}/players/f2`), { id: "f2", name: "Gus Glide", number: 4, stats: {} });
  batch.set(db.doc("coachInvites/inv_original"), { emailLower: OWNER.email, status: "accepted", boundUid: OWNER.uid, issuedBy: "migration", createdAt: new Date() });
  batch.set(db.doc("coachWorkspaces/ws_original"), { ownerUid: OWNER.uid, status: "active", createdAt: new Date() });
  batch.set(db.doc(`coaches/${OWNER.uid}`), { workspaceId: "ws_original", inviteId: "inv_original", status: "active", createdAt: new Date() });
  batch.set(db.doc("coachInvites/inv_new"), { emailLower: NEWBIE, status: "approved", boundUid: null, issuedBy: "owner-cli", createdAt: new Date() });
  batch.set(db.doc(`teams/${TIGERS}`), tigers);
  batch.set(db.doc(`teams/${FALCONS}`), falcons);
  batch.set(db.doc(`publicTeams/${TIGERS}`), projection(tigers, FALL));
  batch.set(db.doc(`publicTeams/${FALCONS}`), projection(falcons, null));
  await batch.commit();
  await applyOps(db, planSplit(await readState(db)), "browser-split");
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  browser = await launchGuardedBrowser(BASE);
});

after(async () => {
  if (BASE) await loadRules(REPO);
  try {
    if (browser) assertNoExternalRequests(browser);
  } finally {
    await browser?.close();
  }
});

const openPages = new Set();
async function failShots(label) {
  if (!SHOTS) return;
  let i = 0;
  for (const p of openPages) await p.screenshot({ path: path.join(SHOTS, `FAIL-${label}-${i++}.png`), fullPage: true }).catch(() => {});
}
const guarded = (label, fn) => async () => {
  try {
    await fn();
  } catch (e) {
    await failShots(label);
    throw e;
  } finally {
    openPages.clear();
  }
};

async function newPage(viewport, { tallies = true, googleEmail = null } = {}) {
  const mobile = viewport.width < 500;
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
  await ctx.addInitScript(
    ({ tallies, token }) => {
      if (tallies) localStorage.setItem("bc:feature:multiCoach", "1");
      if (token) window.__bcTestGoogleIdToken = token;
    },
    { tallies, token: googleEmail ? JSON.stringify({ sub: `google-${googleEmail}`, email: googleEmail, email_verified: true }) : null },
  );
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  page.on("dialog", (d) => void d.accept());
  openPages.add(page);
  return page;
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function noOverflow(page, label) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `${label}: horizontal overflow ${sw} > ${cw}`);
}

async function signInOwner(page) {
  await page.goto(`${BASE}/signin/`);
  await page.getByRole("button", { name: "Use email and password instead" }).click();
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill("fixture-pass-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/admin\/?$/, { timeout: 30000 });
  await page.locator('[data-coach-gate="approved"]').waitFor({ timeout: 30000 });
}

const primary = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
/** The document shows this team color (branding applies a render after the team loads). */
async function expectPrimary(page, color, label) {
  await page
    .waitForFunction((c) => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() === c, color, { timeout: 15000 })
    .catch(() => {});
  assert.equal(await primary(page), color, label);
}
const adminReady = (page) => page.locator('[data-admin-ready="true"]').waitFor({ timeout: 30000 });

test("O: a new coach onboards: first team → season → roster → current → published (1366)", { skip: SKIP }, guarded("O", async () => {
  await loadRules(TARGET);
  const page = await newPage(V[1366], { googleEmail: NEWBIE });
  await page.goto(`${BASE}/signin/`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL(/\/admin\/?$/, { timeout: 30000 });
  await page.locator("[data-empty-workspace]").waitFor({ timeout: 30000 });
  await shot(page, "O-1366-empty");
  await page.getByRole("button", { name: "Set up your first team" }).click();
  await page.waitForURL(/setup=1/);

  // Team (Team Designer inside setup): identity and colors.
  await page.getByLabel("Team name").fill("Gamma Ridge");
  await page.getByLabel("Short name").fill("COM");
  await page.getByLabel("Division / age group").fill("9U");
  await page.getByRole("button", { name: /^Softball/ }).click();
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.locator("#color-dark-primary").fill("#7c3aed");
  await page.locator("#color-dark-secondary").fill("#f59e0b");
  await noOverflow(page, "1366 onboarding team");
  await shot(page, "O-1366-team");
  await page.getByRole("button", { name: "Create team" }).dblclick();
  await page.waitForURL(/step=season&team=t_[0-9a-f]{20}/, { timeout: 30000 });
  const teamId = new URL(page.url()).searchParams.get("team");
  const uid = (await auth.getUserByEmail(NEWBIE)).uid;
  const t = (await db.doc(`teams/${teamId}`).get()).data();
  assert.equal(t.ownerUid, uid);
  assert.equal(t.teamName, "Gamma Ridge");
  assert.equal(t.sport, "softball");
  assert.equal(t.palettes.dark.primary, "#7c3aed");
  assert.equal((await db.collection("teams").where("ownerUid", "==", uid).get()).size, 1, "double click made one team");
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() === "#7c3aed", null, { timeout: 15000 });
  assert.match(await page.locator("header").first().innerText(), /tallies/, "Tallies header stays");

  // Season.
  await page.getByRole("combobox", { name: "Season term" }).selectOption("Fall");
  await page.getByRole("textbox", { name: "Season year" }).fill("2026");
  await page.getByRole("button", { name: "Create draft season" }).dblclick();
  await page.waitForURL(/step=roster/, { timeout: 30000 });
  const seasons = await db.collection("seasons").where("teamId", "==", teamId).get();
  assert.equal(seasons.size, 1, "one draft despite the double click");
  const seasonId = seasons.docs[0].id;
  assert.match(seasonId, /^s_[0-9a-f]{20}$/);
  assert.equal(seasons.docs[0].data().status, "draft");

  // Roster.
  await page.getByRole("button", { name: "Add new player" }).click();
  await page.getByLabel("Name").last().fill("Nova Reed");
  await page.getByRole("button", { name: "Add new player" }).click();
  await page.getByLabel("Name").last().fill("Orion Pike");
  await page.getByRole("button", { name: /^Add 2 to Fall 2026/ }).click();
  await page.getByText(/Added 2 players to Fall 2026/).waitFor({ timeout: 20000 });
  for (const d of (await db.collection(`seasons/${seasonId}/players`).get()).docs) {
    assert.ok(!("careerPlayerId" in d.data()) && !("shirtSize" in d.data()), "private fields stay private");
  }
  await page.getByRole("button", { name: "Next: Ready" }).click();
  await page.waitForURL(/step=ready/);
  await page.getByRole("button", { name: "Prepare first game" }).click();
  await page.getByRole("button", { name: "Make current and open lineup" }).click();
  await page.getByText("Lineup Builder").first().waitFor({ timeout: 30000 });
  assert.equal((await db.doc(`teams/${teamId}`).get()).data().currentSeasonId, seasonId);
  assert.equal((await db.doc("app/config").get()).data().currentSeasonId, FALL, "global setting untouched");
  await shot(page, "O-1366-lineup");

  // Publish for parents.
  await page.locator("[data-parents-toggle]").click();
  const mgr = page.locator(`[data-team-manager="${teamId}"]`);
  await mgr.locator(`[data-publish="${seasonId}"]`).click();
  await mgr.getByText("Current season: Fall 2026 · parents can see it").waitFor({ timeout: 30000 });
  const parent = await newPage(V[390]);
  await parent.goto(`${BASE}/teams/${teamId}/`);
  await parent.getByText("Nova Reed").first().waitFor({ timeout: 30000 });
  assert.doesNotMatch(await parent.locator("body").innerText(), /Sign out|Lineup Builder|Stat Update/);
  assert.deepEqual([...page.errors, ...parent.errors], []);
  await parent.context().close();
  await page.context().close();
}));

test("R: roster, stats, lineup, final awards, and recognition inside the selected team (1440)", { skip: SKIP }, guarded("R", async () => {
  await loadRules(TARGET);
  const page = await newPage(V[1440]);
  await signInOwner(page);
  await page.locator(`[data-team-link-row="${FALCONS}"]`).click();
  await adminReady(page);
  await expectPrimary(page, "#2563eb", "Falcons colors, not Tigers orange");
  assert.match(await page.locator("[data-admin-context]").innerText(), /Falcons/);
  assert.doesNotMatch(await page.locator("main").innerText(), /Mustang Tigers|Alex Rivera/);

  // Player Update: shirt size goes to the private profile.
  await page.getByRole("button", { name: "Player Update", exact: true }).click();
  await page.getByRole("textbox", { name: "Number" }).first().waitFor({ timeout: 20000 });
  await page.getByRole("textbox", { name: "Number" }).first().fill("21");
  await page.getByRole("button", { name: "Save player changes" }).click();
  await page.getByText(/Saved changes for 1 player/).waitFor({ timeout: 20000 });
  const edited = (await db.collection(`seasons/${F_FALL}/players`).where("number", "==", 21).get()).docs[0];
  assert.ok(edited, "number saved");
  assert.ok(!("shirtSize" in edited.data()) && !("careerPlayerId" in edited.data()));
  assert.ok((await edited.ref.collection("private").doc("profile").get()).exists, "identity kept privately");

  // Stat Update: a scrimmage with batting, pitching, and fielding values.
  await page.getByRole("button", { name: "Stat Update", exact: true }).click();
  await page.getByRole("textbox", { name: "Opponent" }).fill("Gamma Ridge");
  await page.getByRole("textbox", { name: "Date" }).fill("2026-09-12");
  await page.getByRole("textbox", { name: "Us" }).fill("5");
  await page.getByRole("textbox", { name: "Them" }).fill("3");
  const row = page.locator("div.rounded-2xl.border.p-4", { hasText: "Frankie Falcon" }).first();
  await row.getByRole("textbox", { name: "AB", exact: true }).fill("3");
  await row.getByRole("textbox", { name: "H", exact: true }).fill("2");
  await row.getByRole("textbox", { name: "2B", exact: true }).fill("1");
  await row.getByRole("textbox", { name: "BB", exact: true }).fill("1");
  await page.getByRole("button", { name: "Save game" }).click();
  await page.getByText(/Saved game vs Gamma Ridge/).waitFor({ timeout: 20000 });
  const st = (await db.doc(`seasons/${F_FALL}/players/f1`).get()).data().stats;
  assert.equal(st.atBats, 3);
  assert.equal(st.hits, 2);
  assert.equal(st.doubles, 1);
  assert.equal(st.walks, 1);
  assert.equal((await db.collection(`seasons/${F_FALL}/games`).get()).size, 1);
  for (const s of [FALL, SPRING]) {
    assert.equal((await db.collection(`seasons/${s}/games`).where("opponent", "==", "Gamma Ridge").get()).size, 0, "nothing written to the Tigers");
  }
  await shot(page, "R-1440-stats");

  // Lineup.
  await page.getByRole("button", { name: "Lineup", exact: true }).click();
  await page.getByRole("button", { name: "Save Lineup" }).click();
  await page.waitForFunction(async () => true);
  await page.getByRole("button", { name: "Save Lineup" }).waitFor();
  for (let i = 0; i < 20 && !(await db.doc(`seasons/${F_FALL}/lineups/current`).get()).exists; i++) await page.waitForTimeout(250);
  const lineup = (await db.doc(`seasons/${F_FALL}/lineups/current`).get()).data();
  assert.ok(lineup, "lineup saved in the Falcons season");
  assert.ok(JSON.stringify(lineup).includes("Frankie Falcon") || JSON.stringify(lineup).includes("f1"));
  assert.doesNotMatch(JSON.stringify(lineup), /Alex Rivera/, "no foreign players");

  // Season Update: end the season, pick a final award.
  await page.getByRole("button", { name: "Season Update", exact: true }).click();
  await page.getByRole("button", { name: "End Season" }).click();
  await page.getByRole("button", { name: "Confirm End Season" }).click();
  await page.getByRole("button", { name: "Save Final Awards" }).waitFor({ timeout: 20000 });
  // The first award picker in the Final Coach Awards panel is MVP.
  await page.getByText("Final Coach Awards").locator("xpath=../..").locator("select").first().selectOption("f1");
  await page.getByRole("button", { name: "Save Final Awards" }).click();
  for (let i = 0; i < 20 && (await db.doc(`seasons/${F_FALL}`).get()).data().finalAwards?.mvp !== "f1"; i++) await page.waitForTimeout(250);
  assert.equal((await db.doc(`seasons/${F_FALL}`).get()).data().finalAwards.mvp, "f1");

  // Recognition sheet: the coach's player page inside the team, 8×10 print.
  await page.locator("[data-player-pages]").getByRole("link", { name: /Frankie Falcon/ }).click();
  await page.waitForURL(new RegExp(`/admin/\\?team=${FALCONS}&id=f1&season=${F_FALL}`));
  await page.locator("[data-player-plaque]").waitFor({ timeout: 30000 });
  assert.ok(await page.getByRole("button", { name: "Arrange Awards" }).isVisible(), "coach controls in the coach area");
  await page.emulateMedia({ media: "print" });
  const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
  await page.emulateMedia({ media: "screen" });
  assert.equal((pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length, 1);
  const box = pdf.match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\]/);
  assert.deepEqual([box?.[1], box?.[2]], ["720", "576"], "8x10");
  await shot(page, "R-1440-plaque");
  assert.deepEqual(page.errors, []);
  await page.context().close();
}));

test("S: switching teams mid-save writes only the first team; foreign and invalid ids never fall back (1366)", { skip: SKIP }, guarded("S", async () => {
  await loadRules(TARGET);
  const page = await newPage(V[1366]);
  await signInOwner(page);
  await page.goto(`${BASE}/admin/?team=${TIGERS}`);
  await adminReady(page);
  await expectPrimary(page, "#ff4d00", "Tigers keep their orange");
  await page.getByRole("button", { name: "Stat Update", exact: true }).click();
  await page.getByRole("textbox", { name: "Opponent" }).fill("Switch Test");
  await page.getByRole("textbox", { name: "Date" }).fill("2026-11-14");
  const row = page.locator("div.rounded-2xl.border.p-4", { hasText: "Alex Rivera" }).first();
  await row.getByRole("textbox", { name: "AB", exact: true }).fill("1");
  // Switch teams the moment the save starts: the save keeps its own team's
  // season and must land there, never in the newly selected team.
  await page.getByRole("button", { name: "Save game" }).click();
  // Wait until the save is in flight, then switch.
  await page.getByRole("button", { name: /Saving/ }).first().waitFor({ timeout: 5000 });
  await page.locator("#team-switch").selectOption(FALCONS);
  await page.waitForURL(new RegExp(`team=${FALCONS}`), { waitUntil: "commit" });
  await adminReady(page);
  await expectPrimary(page, "#2563eb", "Falcons after the switch");
  assert.doesNotMatch(await page.locator("main").innerText(), /Switch Test|Alex Rivera/, "no stale Tigers state");
  for (let i = 0; i < 80 && (await db.collection(`seasons/${FALL}/games`).where("opponent", "==", "Switch Test").get()).empty; i++) await page.waitForTimeout(250);
  assert.equal((await db.collection(`seasons/${FALL}/games`).where("opponent", "==", "Switch Test").get()).size, 1, "landed in the Tigers season it was made for");
  assert.equal((await db.collection(`seasons/${F_FALL}/games`).where("opponent", "==", "Switch Test").get()).size, 0, "never in the Falcons");

  for (const id of ["no-such-team", "hawks-9999"]) {
    await page.goto(`${BASE}/admin/?team=${id}`);
    await page.locator('[data-team-manager="notFound"]').waitFor({ timeout: 30000 });
    assert.doesNotMatch(await page.locator("main").innerText(), /Tigers|Falcons|Alex Rivera|Mustang/);
  }
  // Back/forward and refresh keep the selected team.
  await page.goto(`${BASE}/admin/?team=${FALCONS}`);
  await adminReady(page);
  await page.goto(`${BASE}/admin/?team=${TIGERS}`);
  await adminReady(page);
  await page.goBack();
  await page.waitForURL(new RegExp(`team=${FALCONS}`));
  await adminReady(page);
  assert.match(await page.locator("[data-admin-context]").innerText(), /Falcons/);
  await page.reload();
  await adminReady(page);
  assert.match(await page.locator("[data-admin-context]").innerText(), /Falcons/);
  assert.deepEqual(page.errors, []);
  await page.context().close();
}));

for (const tag of ["1366", "1440", "390", "360"]) {
  test(`V: the team Admin fits the viewport (${tag})`, { skip: SKIP }, async () => {
    await loadRules(TARGET);
    const page = await newPage(V[tag]);
    await signInOwner(page);
    await page.goto(`${BASE}/admin/?team=${FALCONS}`);
    await adminReady(page);
    for (const tab of ["Stat Update", "Lineup", "Player Update", "Season Update", "Team Designer"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await page.waitForTimeout(300);
      await noOverflow(page, `${tag} ${tab}`);
    }
    await page.locator("[data-parents-toggle]").click();
    await page.locator(`[data-team-manager="${FALCONS}"]`).waitFor({ timeout: 20000 });
    await noOverflow(page, `${tag} parents panel`);
    await shot(page, `V-${tag}-team-admin`);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

test("T: the legacy Tigers Admin (flags off) is unchanged (1366)", { skip: SKIP }, guarded("T", async () => {
  await loadRules(REPO);
  const page = await newPage(V[1366], { tallies: false });
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Coach Login" }).click();
  await page.getByPlaceholder("Email").fill(OWNER.email);
  await page.getByPlaceholder("Password").fill("fixture-pass-123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/admin/`);
  await adminReady(page);
  assert.match(await page.locator("[data-admin-context]").innerText(), /Mustang Tigers · Fall 2026/);
  assert.equal(await page.locator("[data-team-workspace]").count(), 0);
  assert.equal(await primary(page), "#ff4d00");
  assert.deepEqual(page.errors, []);
  await page.context().close();
}));
