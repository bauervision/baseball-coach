// The Tallies migration (Checkpoint D1) in the browser: the representative
// legacy dataset is shown by the legacy app, migrated by the real D1 tool
// (applyPlan on the emulator), and must then read the same on the Tallies
// team routes under the target rules: same stats, awards, branding, and a
// one-page 8×10 recognition sheet. Emulator build through the production
// guard; skipped without BROWSER_BASE_URL. Screenshots to BC_SCREENSHOT_DIR.
//
// M1 parents: legacy pages before = team routes after; legacy links
//    redirect; the Falcons draft is unreachable; no private fields (1366/390)
// M2 the owner signs in and finds both teams in the workspace; the Tigers'
//    Admin opens on Fall 2026 (1440)
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { assertNoExternalRequests, launchGuardedBrowser } from "./support/guard.mjs";
import { FALCONS, FALCONS_DRAFT, FALL, OWNER, SPRING, legacyState, seedState } from "../support/talliesMigrationFixture.mjs";

const BASE = process.env.BROWSER_BASE_URL;
const SKIP = !BASE && "set BROWSER_BASE_URL";
const SHOTS = process.env.BC_SCREENSHOT_DIR;
const PROJECT = "demo-baseball-coach";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const TARGET = fs.readFileSync("firestore.target.rules", "utf8");
const REPO = fs.readFileSync("firestore.rules", "utf8");
const EMAIL = "coach@example.test";
const V = { 1366: { width: 1366, height: 768 }, 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } };
const PRIVATE = /shirt\s*size|careerPlayerId|identityStatus|linkedFrom|lifecycleHistory|coach-mike|ws_0000|coach@example\.test|a1a1a1a1-/i;

let browser;
let db;
let teamId;
const legacy = {};

async function loadRules(content) {
  const res = await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: "PUT",
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }),
  });
  if (!res.ok) throw new Error(`rules load failed: ${res.status}`);
}

async function newPage(viewport, { tallies = true, session = null } = {}) {
  const mobile = viewport.width < 500;
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
  await ctx.addInitScript(
    ({ tallies, session }) => {
      if (tallies) localStorage.setItem("bc:feature:multiCoach", "1");
      if (session) localStorage.setItem("baseball-coach:session", JSON.stringify(session));
    },
    { tallies, session },
  );
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  return page;
}
async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}
// Page content without the season picker (the legacy app lists every
// season in the database; a team route lists that team's own only).
const contentText = (page) =>
  page.locator("main").first().evaluate((main) => {
    const pickers = [...main.querySelectorAll("select")].map((el) => el.closest("div") ?? el);
    pickers.forEach((el) => (el.style.display = "none"));
    const text = main.innerText;
    pickers.forEach((el) => (el.style.display = ""));
    return text;
  });
const primary = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
const settle = (page) => page.waitForTimeout(800);

before(async () => {
  if (!BASE) return;
  process.env.FIRESTORE_EMULATOR_HOST = FS_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");
  const { fromJson } = await import("../../tools/identity/firestore.mjs");
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
  db = getFirestore();
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  await getAuth().createUser({ uid: OWNER, email: EMAIL, password: "fixture-pass-123" });
  await seedState(db, legacyState(), fromJson);
  await loadRules(REPO);
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

test("M0: the legacy app shows the unmigrated Tigers (baseline, flags off)", { skip: SKIP }, async () => {
  const page = await newPage(V[1366], { tallies: false, session: { role: "public", name: "Parent" } });
  for (const s of [SPRING, FALL]) {
    await page.goto(`${BASE}/trophies/?season=${s}`);
    await page.getByText(/Trophy/i).first().waitFor({ timeout: 30000 });
    await settle(page);
    legacy[s] = { trophies: await contentText(page), primary: await primary(page) };
    await page.goto(`${BASE}/?season=${s}`);
    await page.getByText(s === SPRING ? "Logan Pike" : "Alex Rivera").first().waitFor({ timeout: 30000 });
    await settle(page);
    legacy[s].home = await contentText(page);
  }
  await page.goto(`${BASE}/player/?id=p01&season=${SPRING}`);
  await page.locator("[data-player-plaque]").waitFor({ timeout: 30000 });
  await settle(page);
  legacy.plaque = await page.locator("[data-player-plaque]").first().innerText();
  await shot(page, "M0-1366-legacy-fall");
  assert.deepEqual(page.errors, []);
  await page.context().close();

  // Migrate with the D1 tool (emulator only), exactly as the CLI applies it.
  const { buildPlan } = await import("../../tools/tallies-migration/model.mjs");
  const { applyPlan, openEmulatorDatabase, readLiveState } = await import("../../tools/tallies-migration/emulator.mjs");
  const { verifyMigration } = await import("../../tools/tallies-migration/verify.mjs");
  const conn = await openEmulatorDatabase({ FIRESTORE_EMULATOR_HOST: FS_HOST }, PROJECT);
  try {
    const source = await readLiveState(conn.db);
    const plan = buildPlan(source, { ownerUid: OWNER });
    assert.deepEqual(plan.blockers, []);
    await applyPlan(conn.db, plan, source);
    const report = verifyMigration(source, await readLiveState(conn.db), { ownerUid: OWNER });
    assert.ok(report.ok, JSON.stringify(report.checks.filter((c) => !c.ok)));
    teamId = plan.legacyTeamId;
  } finally {
    await conn.close();
  }
});

test("M1: parents read the migrated Tigers on the team route exactly as before; one 8×10 page (1366)", { skip: SKIP }, async () => {
  assert.ok(teamId, "migrated in M0");
  await loadRules(TARGET);
  const page = await newPage(V[1366]);
  // The permanent parent link opens the published current season.
  await page.goto(`${BASE}/teams/${teamId}/`);
  await page.getByText("Alex Rivera").first().waitFor({ timeout: 30000 });
  await settle(page);
  assert.equal(await contentText(page), legacy[FALL].home, "current season = Fall 2026, identical");
  for (const s of [SPRING, FALL]) {
    await page.goto(`${BASE}/teams/${teamId}/seasons/${s}/trophies/`);
    await page.getByText(/Trophy/i).first().waitFor({ timeout: 30000 });
    await settle(page);
    assert.equal(await contentText(page), legacy[s].trophies, `${s}: trophy case identical`);
    assert.equal(await primary(page), legacy[s].primary, `${s}: orange branding identical`);
    await page.goto(`${BASE}/teams/${teamId}/seasons/${s}/home/`);
    await page.getByText(s === SPRING ? "Logan Pike" : "Alex Rivera").first().waitFor({ timeout: 30000 });
    await settle(page);
    const text = await contentText(page);
    assert.equal(text, legacy[s].home, `${s}: roster, stats, leaders identical`);
    assert.doesNotMatch(text, PRIVATE);
  }
  await shot(page, "M1-1366-fall-home");

  // Old links still work: they redirect to the team route.
  await page.goto(`${BASE}/player/?id=p01&season=${SPRING}`);
  await page.waitForURL(new RegExp(`/teams/${teamId}/seasons/${SPRING}/players/p01/?$`), { timeout: 30000 });
  await page.locator("[data-player-plaque]").waitFor({ timeout: 30000 });
  await settle(page);
  assert.equal(await page.locator("[data-player-plaque]").first().innerText(), legacy.plaque, "recognition sheet identical");
  assert.equal(await page.locator(".recognition-sheet").first().evaluate((el) => el.style.getPropertyValue("--plq-brand").trim()), "#ff4d00");
  assert.doesNotMatch(await page.locator("main").first().innerText(), PRIVATE);
  await page.emulateMedia({ media: "print" });
  const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
  await page.emulateMedia({ media: "screen" });
  assert.equal((pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length, 1, "one page");
  const box = pdf.match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\]/);
  assert.deepEqual([box?.[1], box?.[2]], ["720", "576"], "8x10");
  await shot(page, "M1-1366-spring-plaque");

  // The Falcons draft is not public; the Falcons page has no season yet.
  await page.goto(`${BASE}/teams/${FALCONS}/seasons/${FALCONS_DRAFT}/home/`);
  await page.getByText(/not found/i).first().waitFor({ timeout: 30000 });
  assert.doesNotMatch(await page.locator("main").first().innerText(), /Toby Grant|Spring 2027/);
  await page.goto(`${BASE}/teams/${FALCONS}/`);
  await page.getByText(/no published current season yet/i).first().waitFor({ timeout: 30000 });
  assert.doesNotMatch(await page.locator("main").first().innerText(), /Toby Grant/);
  assert.deepEqual(page.errors, []);
  await page.context().close();

  const phone = await newPage(V[390]);
  await phone.goto(`${BASE}/teams/${teamId}/`);
  await phone.getByText("Alex Rivera").first().waitFor({ timeout: 30000 });
  const { sw, cw } = await phone.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `390: horizontal overflow ${sw} > ${cw}`);
  await shot(phone, "M1-390-team-home");
  assert.deepEqual(phone.errors, []);
  await phone.context().close();
});

test("M2: the owner finds both migrated teams; the Tigers' Admin opens on Fall 2026 (1440)", { skip: SKIP }, async () => {
  await loadRules(TARGET);
  const page = await newPage(V[1440]);
  await page.goto(`${BASE}/signin/`);
  await page.getByRole("button", { name: "Use email and password instead" }).click();
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill("fixture-pass-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/admin\/?$/, { timeout: 30000 });
  await page.locator('[data-coach-gate="approved"]').waitFor({ timeout: 30000 });
  await page.getByText("Tigers").first().waitFor({ timeout: 30000 });
  await page.getByText("Falcons").first().waitFor({ timeout: 30000 });
  await shot(page, "M2-1440-workspace");
  await page.goto(`${BASE}/admin/?team=${teamId}`);
  await page.locator(`[data-team-workspace="${teamId}"]`).waitFor({ timeout: 30000 });
  await page.getByText(/Fall 2026/).first().waitFor({ timeout: 30000 });
  assert.equal(await page.locator('[data-team-manager="notFound"]').count(), 0);
  await shot(page, "M2-1440-tigers-admin");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
