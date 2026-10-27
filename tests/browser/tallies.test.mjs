// Tallies brand experience and permanent team routes in the browser
// (emulator build, through the production guard; target rules loaded for the
// multi-coach scenarios). Google sign-in uses the emulator-only test
// credential seam — NOT a production Google OAuth test. Skipped without
// BROWSER_BASE_URL. Screenshots go to BC_SCREENSHOT_DIR when set (outside Git).
//
// A  public landing: wordmark font, tagline, Coach sign in, invitation-only,
//    keyboard order, no overflow (1366/1440/390/360)
// B  sign-in: approved coach → own workspace; unapproved → Access not enabled;
//    password fallback; nothing private while access is checked (1440/390)
// C  parents open /teams/{teamId}/ anonymously: published current season,
//    history, player pages, no private fields, drafts unreachable, no coach
//    controls, legacy links redirect (1440/390/360)
// D  one coach, two teams, independent current seasons; Copy team link;
//    parent links stable (1366)
// E  cross-coach isolation in the workspace; both see published pages (1440)
// F  Tigers history unchanged: same stats/awards/branding as the legacy view;
//    recognition sheet prints as one 8×10 page (1366)
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
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
const HAWKS_COACH = "hawks.coach@gmail.com";
const STRANGER = "stranger@gmail.com";
const TIGERS = "tigers-0001";
const FALCONS = "falcons-0002";
const HAWKS = "hawks-0001";
const SPRING = "tigers-2026";
const FALL = "tigers-fall-2026";
const DRAFT = "tigers-spring-2027";
const F_ACTIVE = "falcons-fall-2026";
const B_PUB = "hawks-fall-2026";
const V = {
  1366: { width: 1366, height: 768 },
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
  360: { width: 360, height: 780 },
};

let browser;
let db;
let auth;
let hawksUid;

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
  hawksUid = "google-hawks-coach";
  await auth.createUser({ uid: hawksUid, email: HAWKS_COACH, emailVerified: true });
  await auth.updateUser(hawksUid, { providerToLink: { providerId: "google.com", uid: `google-${HAWKS_COACH}`, email: HAWKS_COACH } });

  const snap = productionShapedSnapshot({ migrated: true });
  const tigers = team(TIGERS, OWNER.uid, "ws_original", { currentSeasonId: FALL });
  const falcons = team(FALCONS, OWNER.uid, "ws_original", { teamName: "Falcons", shortName: "FAL" });
  const hawks = team(HAWKS, hawksUid, "ws_hawks", { teamName: "Hawks", shortName: "HWK", currentSeasonId: B_PUB });
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
  batch.set(db.doc(`seasons/${DRAFT}`), { teamId: TIGERS, ownerUid: OWNER.uid, teamName: "Tigers", seasonLabel: "Spring 2027", status: "draft", published: false, gamesPlayed: 0, record: { wins: 0, losses: 0, ties: 0 } });
  batch.set(db.doc(`seasons/${DRAFT}/players/d1`), { name: "Draft Dana", number: 4, stats: {}, shirtSize: "YM" });
  batch.set(db.doc(`seasons/${F_ACTIVE}`), { teamId: FALCONS, ownerUid: OWNER.uid, teamName: "Falcons", seasonLabel: "Fall 2026", league: "Pinto", status: "active", published: false, branding: { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: FALCONS, teamName: "Falcons", shortName: "FAL" } });
  batch.set(db.doc(`seasons/${F_ACTIVE}/players/f1`), { name: "Frankie Falcon", number: 9, stats: {} });
  batch.set(db.doc(`seasons/${B_PUB}`), { teamId: HAWKS, ownerUid: hawksUid, teamName: "Hawks", seasonLabel: "Fall 2026", status: "active", published: true, branding: { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: HAWKS, teamName: "Hawks", shortName: "HWK" } });
  batch.set(db.doc(`seasons/${B_PUB}/players/h1`), { name: "Harper Hawk", number: 11, stats: {} });
  // Invitation-bound coaches and workspaces (as Checkpoint B / the migration write them).
  batch.set(db.doc("coachInvites/inv_original"), { emailLower: OWNER.email, status: "accepted", boundUid: OWNER.uid, issuedBy: "migration", createdAt: new Date() });
  batch.set(db.doc("coachWorkspaces/ws_original"), { ownerUid: OWNER.uid, status: "active", createdAt: new Date() });
  batch.set(db.doc(`coaches/${OWNER.uid}`), { workspaceId: "ws_original", inviteId: "inv_original", status: "active", createdAt: new Date() });
  batch.set(db.doc("coachInvites/inv_hawks"), { emailLower: HAWKS_COACH, status: "accepted", boundUid: hawksUid, issuedBy: "owner-cli", createdAt: new Date() });
  batch.set(db.doc("coachWorkspaces/ws_hawks"), { ownerUid: hawksUid, status: "active", createdAt: new Date() });
  batch.set(db.doc(`coaches/${hawksUid}`), { workspaceId: "ws_hawks", inviteId: "inv_hawks", status: "active", createdAt: new Date() });
  batch.set(db.doc(`teams/${TIGERS}`), tigers);
  batch.set(db.doc(`teams/${FALCONS}`), falcons);
  batch.set(db.doc(`teams/${HAWKS}`), hawks);
  batch.set(db.doc(`publicTeams/${TIGERS}`), projection(tigers, FALL));
  batch.set(db.doc(`publicTeams/${HAWKS}`), projection(hawks, B_PUB));
  await batch.commit();
  // The public/private split, exactly as the migration tool applies it.
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

const googleToken = (email) => JSON.stringify({ sub: `google-${email}`, email, email_verified: true });

async function newPage(viewport, { tallies = true, googleEmail = null, session = null, clipboard = false } = {}) {
  const mobile = viewport.width < 500;
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
  if (clipboard) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await ctx.addInitScript(
    ({ tallies, token, session }) => {
      if (tallies) localStorage.setItem("bc:feature:multiCoach", "1");
      if (token) window.__bcTestGoogleIdToken = token;
      if (session) localStorage.setItem("baseball-coach:session", JSON.stringify(session));
    },
    { tallies, token: googleEmail ? googleToken(googleEmail) : null, session },
  );
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  return page;
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function noOverflow(page, label) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `${label}: horizontal overflow ${sw} > ${cw}`);
}

const mainText = (page) => page.locator("main").first().innerText();
// Page content without the season picker: the legacy single-team app lists
// every season in the database; a team route lists that team's own only.
const contentText = (page) =>
  page.locator("main").first().evaluate((main) => {
    const pickers = [...main.querySelectorAll("select")].map((el) => el.closest("div") ?? el);
    pickers.forEach((el) => (el.style.display = "none"));
    const text = main.innerText;
    pickers.forEach((el) => (el.style.display = ""));
    return text;
  });
const primary = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
const PRIVATE = /shirt\s*size|careerPlayerId|identityStatus|linkedFrom|lifecycleHistory|coach-mike|ws_original|coach@example\.test/i;

async function signInGoogle(page) {
  await page.goto(`${BASE}/signin/`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL(/\/admin\/?$/, { timeout: 30000 });
}

async function signInPassword(page) {
  await page.goto(`${BASE}/signin/`);
  await page.getByRole("button", { name: "Use email and password instead" }).click();
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill("fixture-pass-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/admin\/?$/, { timeout: 30000 });
  await page.locator('[data-coach-gate="approved"]').waitFor({ timeout: 30000 });
}

for (const tag of ["1366", "1440", "390", "360"]) {
  test(`A: the Tallies landing page (${tag})`, { skip: SKIP }, async () => {
    await loadRules(TARGET);
    const page = await newPage(V[tag]);
    const fonts = [];
    page.on("response", async (r) => {
      if (r.url().endsWith(".woff2")) fonts.push(await r.body());
    });
    await page.goto(`${BASE}/`);
    const word = page.locator("h1 [data-tallies-wordmark]");
    await word.waitFor({ timeout: 30000 });
    assert.equal((await word.innerText()).trim(), "tallies");
    // Authentic Bubblegum Sans, served from this site.
    const font = await page.evaluate(async () => {
      await document.fonts.ready;
      const el = document.querySelector("h1 [data-tallies-wordmark]");
      const family = getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim();
      const loaded = [...document.fonts].some((f) => f.family.replace(/["']/g, "") === family && f.status === "loaded");
      const bodyFamily = getComputedStyle(document.querySelector("[data-tagline]")).fontFamily;
      return { family, loaded, bodyFamily };
    });
    assert.ok(font.loaded, `wordmark font loaded (${font.family})`);
    assert.doesNotMatch(font.bodyFamily, /bubblegum/i, "tagline uses the supporting typeface");
    const want = crypto.createHash("sha256").update(fs.readFileSync("src/app/fonts/BubblegumSans-Regular-latin.woff2")).digest("hex");
    assert.ok(fonts.some((b) => crypto.createHash("sha256").update(b).digest("hex") === want), "the bundled OFL font file is what the page loads");

    const text = await page.locator("[data-tallies-landing]").innerText();
    assert.match(text, /Every season counts\./);
    assert.match(text, /Track the stats\. Celebrate the moments\. Keep the journey\./);
    assert.match(text, /Track the season[\s\S]*Celebrate the moments[\s\S]*Keep the journey/);
    assert.match(text, /Invitation only/);
    assert.match(text, /Baseball[\s\S]*Softball[\s\S]*More sports later\./);
    assert.doesNotMatch(text, /Tigers|Mustang|Falcons|Hawks|Alex Rivera|pricing|sign up|register|testimonial/i, "no team data, registration, or pricing");
    const cta = page.locator("[data-coach-signin-cta]");
    const box = await cta.boundingBox();
    assert.ok(box && box.y + box.height <= V[tag].height, "Coach sign in is visible without scrolling");
    await noOverflow(page, `${tag} landing`);

    // Keyboard: home lockup, then Coach sign in, then the hero action.
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Tallies home");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Coach sign in");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/signin\/?$/);
    await page.getByRole("heading", { name: "Coach sign in" }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Coach sign in", "focus moves to the sign-in heading");
    const card = await page.locator(".tallies-card").boundingBox();
    assert.ok(card.y + card.height <= V[tag].height + 1, "sign-in fits without scrolling");
    await noOverflow(page, `${tag} sign-in`);
    await shot(page, `A-${tag}-signin`);
    await page.goto(`${BASE}/`);
    await page.locator("h1 [data-tallies-wordmark]").waitFor();
    await shot(page, `A-${tag}-landing`);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

test("A: the legacy app (flags off) keeps its home and sign-in gate (1366)", { skip: SKIP }, async () => {
  await loadRules(REPO);
  const page = await newPage(V[1366], { tallies: false });
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Coach Login" }).waitFor({ timeout: 30000 });
  assert.equal(await page.locator("[data-tallies-landing]").count(), 0);
  assert.equal(await page.locator("[data-tallies-wordmark]").count(), 0, "no Tallies branding in the legacy app");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

for (const tag of ["1440", "390"]) {
  test(`B: approved, unapproved, and password coaches (${tag})`, { skip: SKIP }, async () => {
    await loadRules(TARGET);
    // Approved Google coach: own workspace; nothing private while checking.
    const page = await newPage(V[tag], { googleEmail: HAWKS_COACH });
    await page.addInitScript(() => {
      window.__bcSeenBeforeApproved = [];
      new MutationObserver(() => {
        if (document.querySelector('[data-coach-gate="approved"]')) return;
        window.__bcSeenBeforeApproved.push(document.body?.innerText ?? "");
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await signInGoogle(page);
    await page.locator('[data-coach-gate="approved"]').waitFor({ timeout: 30000 });
    await page.locator("[data-team-link-row]").first().waitFor({ timeout: 30000 });
    assert.deepEqual(await page.locator("[data-team-link-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-team-link-row"))), [HAWKS]);
    const before = (await page.evaluate(() => window.__bcSeenBeforeApproved)).join("\n");
    assert.doesNotMatch(before, /Hawks|Tigers|Falcons|Harper|ws_hawks/, "no private content during authorization loading");
    assert.match(await page.locator("header").first().innerText(), /tallies/);
    await noOverflow(page, `${tag} workspace`);
    await shot(page, `B-${tag}-workspace`);
    await page.context().close();

    // Unapproved Google user.
    const stranger = await newPage(V[tag], { googleEmail: STRANGER });
    await signInGoogle(stranger);
    await stranger.locator('[data-coach-gate="notApproved"]').waitFor({ timeout: 30000 });
    const t = await mainText(stranger);
    assert.match(t, /Access not enabled/);
    assert.doesNotMatch(t, /Hawks|Tigers|Falcons|hawks\.coach|coach@example/, "reveals no teams or invited emails");
    assert.ok(await stranger.locator('[data-coach-gate="notApproved"]').getByRole("button", { name: "Sign out" }).isVisible());
    await shot(stranger, `B-${tag}-not-enabled`);
    await stranger.locator('[data-coach-gate="notApproved"]').getByRole("button", { name: "Sign out" }).click();
    await stranger.locator('[data-coach-gate="signedOut"]').waitFor({ timeout: 20000 });
    await stranger.context().close();

    // The original coach's password fallback still works.
    const owner = await newPage(V[tag]);
    await signInPassword(owner);
    await owner.locator("[data-team-link-row]").first().waitFor({ timeout: 30000 });
    assert.deepEqual(
      (await owner.locator("[data-team-link-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-team-link-row")))).sort(),
      [FALCONS, TIGERS],
    );
    assert.equal(await owner.getByRole("button", { name: "Link Google account" }).count(), 1, "password-only coach is offered the explicit link");
    assert.deepEqual([...page.errors, ...stranger.errors, ...owner.errors], []);
    await owner.context().close();
  });
}

for (const tag of ["1440", "390", "360"]) {
  test(`C: parents open the permanent team link anonymously (${tag})`, { skip: SKIP }, async () => {
    await loadRules(TARGET);
    const page = await newPage(V[tag]);
    await page.goto(`${BASE}/teams/${TIGERS}/`);
    await page.getByText("Alex Rivera").first().waitFor({ timeout: 30000 });
    assert.match(await page.locator("footer").innerText(), /Fall 2026/, "the published current season");
    assert.equal(await primary(page), "#ff4d00", "the team's own season branding");
    assert.doesNotMatch(await page.locator("body").innerText(), PRIVATE);
    // No coach controls on parent pages.
    for (const name of ["Sign out", "Admin"]) assert.equal(await page.getByRole("button", { name }).count() + (await page.getByRole("link", { name, exact: true }).count()), 0, name);
    await noOverflow(page, `${tag} team home`);
    await shot(page, `C-${tag}-team-home`);

    // History: only published seasons are offered; the selector keeps team URLs.
    const select = page.getByLabel("Season", { exact: true });
    const options = await select.locator("option").evaluateAll((o) => o.map((x) => x.value));
    assert.deepEqual(options.sort(), [SPRING, FALL].sort(), "no draft in the history list");
    await select.selectOption(SPRING);
    await page.waitForURL(new RegExp(`/teams/${TIGERS}/seasons/${SPRING}/home/?$`));
    await page.getByText("Logan Pike").first().waitFor({ timeout: 30000 });
    assert.match(await page.locator("footer").innerText(), /Spring 2026/);
    await page.reload();
    await page.getByText("Logan Pike").first().waitFor({ timeout: 30000 });
    await page.goBack();
    await page.waitForURL(new RegExp(`/teams/${TIGERS}/?$`));
    await page.getByText("Alex Rivera").first().waitFor({ timeout: 30000 });

    // Player page from the roster, with career history across published seasons.
    await page.getByRole("link", { name: "Open Alex Rivera" }).first().click();
    await page.waitForURL(new RegExp(`/teams/${TIGERS}/seasons/${FALL}/players/[^/]+/?$`));
    await page.getByText("Alex Rivera").first().waitFor({ timeout: 30000 });
    assert.doesNotMatch(await page.locator("body").innerText(), PRIVATE);
    assert.equal(await page.getByRole("button", { name: /arrangement/i }).count(), 0, "no recognition editing");
    await noOverflow(page, `${tag} player`);
    await shot(page, `C-${tag}-player`);

    // Unpublished draft and unknown ids: not found, never another season.
    for (const url of [`/teams/${TIGERS}/seasons/${DRAFT}/home/`, `/teams/${TIGERS}/seasons/${B_PUB}/home/`, "/teams/no-such-team/", "/teams/"]) {
      await page.goto(`${BASE}${url}`);
      await page.locator('[data-team-route-state="notFound"]').waitFor({ timeout: 30000 });
      const body = await page.locator("body").innerText();
      assert.doesNotMatch(body, /Draft Dana|Alex Rivera|Harper Hawk|Spring 2027|Mustang/, `${url}: no fallback content`);
    }
    // A team with nothing published: a clear state, no other team's data.
    await page.goto(`${BASE}/teams/${FALCONS}/`);
    await page.locator('[data-team-route-state="notFound"], [data-team-route-state="noSeason"]').first().waitFor({ timeout: 30000 });
    assert.doesNotMatch(await page.locator("body").innerText(), /Frankie Falcon|Alex Rivera|Mustang/);

    // Legacy links resolve to the permanent route.
    await page.goto(`${BASE}/player/?id=p01&season=${SPRING}`);
    await page.waitForURL(new RegExp(`/teams/${TIGERS}/seasons/${SPRING}/players/p01/?$`), { timeout: 30000 });
    await page.locator("[data-player-plaque]").waitFor({ timeout: 30000 });
    await page.goto(`${BASE}/trophies/?season=${DRAFT}`);
    await page.locator('[data-legacy-link="unresolved"]').waitFor({ timeout: 30000 });
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

test("D: one coach, two teams, independent current seasons; Copy team link (1366)", { skip: SKIP }, async () => {
  await loadRules(TARGET);
  const page = await newPage(V[1366], { clipboard: true });
  await signInPassword(page);
  await page.locator(`[data-team-link-row="${FALCONS}"]`).click();
  await page.waitForURL(new RegExp(`/admin/\\?team=${FALCONS}$`));
  const mgr = page.locator(`[data-team-manager="${FALCONS}"]`);
  await mgr.waitFor({ timeout: 30000 });
  assert.match(await mgr.locator("[data-current-season]").innerText(), /No current season yet/);

  // Copy team link: the permanent route only.
  await mgr.locator("[data-copy-team-link]").click();
  await mgr.getByText("Link copied.").waitFor({ timeout: 10000 });
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(copied, `${BASE}/teams/${FALCONS}/`);
  assert.doesNotMatch(copied, /season|coach|@|Falcons|Pinto|\?/);
  await shot(page, "D-1366-team-manager");

  await mgr.locator(`[data-make-current="${F_ACTIVE}"]`).click();
  await mgr.locator('[data-team-message="ok"]').waitFor({ timeout: 30000 });
  await mgr.getByText("Current season: Fall 2026 · not published yet").waitFor({ timeout: 30000 });
  // Activated but unpublished: parents still see no season.
  const parent = await newPage(V[1366]);
  await parent.goto(`${BASE}/teams/${FALCONS}/`);
  await parent.locator('[data-team-route-state="noSeason"]').waitFor({ timeout: 30000 });
  assert.doesNotMatch(await parent.locator("body").innerText(), /Frankie Falcon/);

  await mgr.locator(`[data-publish="${F_ACTIVE}"]`).click();
  await mgr.getByText("Current season: Fall 2026 · parents can see it").waitFor({ timeout: 30000 });
  await parent.goto(`${BASE}/teams/${FALCONS}/`);
  await parent.getByText("Frankie Falcon").first().waitFor({ timeout: 30000 });
  // The Tigers' link and current season are unchanged.
  await parent.goto(`${BASE}/teams/${TIGERS}/`);
  await parent.getByText("Alex Rivera").first().waitFor({ timeout: 30000 });
  assert.match(await parent.locator("footer").innerText(), /Fall 2026/);
  assert.equal((await db.doc(`teams/${TIGERS}`).get()).data().currentSeasonId, FALL);
  assert.equal((await db.doc("app/config").get()).data().currentSeasonId, FALL, "global config untouched");

  // The same link before and after the season change.
  await mgr.locator("[data-copy-team-link]").click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), copied);
  assert.deepEqual([...page.errors, ...parent.errors], []);
  await parent.context().close();
  await page.context().close();
});

test("E: coaches cannot manage each other's teams; both see published pages (1440)", { skip: SKIP }, async () => {
  await loadRules(TARGET);
  const b = await newPage(V[1440], { googleEmail: HAWKS_COACH });
  await signInGoogle(b);
  await b.locator('[data-coach-gate="approved"]').waitFor({ timeout: 30000 });
  await b.goto(`${BASE}/admin/?team=${TIGERS}`);
  await b.locator('[data-team-manager="notFound"]').waitFor({ timeout: 30000 });
  assert.doesNotMatch(await mainText(b), /Tigers|Fall 2026|Spring 2026|Alex Rivera/);
  await shot(b, "E-1440-not-found");
  await b.goto(`${BASE}/teams/${TIGERS}/`);
  await b.getByText("Alex Rivera").first().waitFor({ timeout: 30000 });
  await b.goto(`${BASE}/teams/${HAWKS}/`);
  await b.getByText("Harper Hawk").first().waitFor({ timeout: 30000 });

  const a = await newPage(V[1440]);
  await signInPassword(a);
  await a.goto(`${BASE}/admin/?team=${HAWKS}`);
  await a.locator('[data-team-manager="notFound"]').waitFor({ timeout: 30000 });
  assert.doesNotMatch(await mainText(a), /Hawks|Harper/);
  await a.goto(`${BASE}/teams/${HAWKS}/`);
  await a.getByText("Harper Hawk").first().waitFor({ timeout: 30000 });
  assert.equal((await db.doc(`seasons/${B_PUB}`).get()).data().published, true, "unchanged");
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context().close();
  await b.context().close();
});

test("F: the Tigers' history reads the same on the team route as in the legacy app; prints one 8×10 page (1366)", { skip: SKIP }, async () => {
  // Legacy view (flags off, the repo rules) of each historical season.
  await loadRules(REPO);
  const legacy = await newPage(V[1366], { tallies: false, session: { role: "public", name: "Parent" } });
  const legacyText = {};
  for (const s of [SPRING, FALL]) {
    await legacy.goto(`${BASE}/trophies/?season=${s}`);
    await legacy.getByText(/Trophy/i).first().waitFor({ timeout: 30000 });
    await legacy.waitForTimeout(800);
    legacyText[s] = { trophies: await contentText(legacy), primary: await primary(legacy) };
    await legacy.goto(`${BASE}/?season=${s}`);
    await legacy.getByText(s === SPRING ? "Logan Pike" : "Alex Rivera").first().waitFor({ timeout: 30000 });
    await legacy.waitForTimeout(800);
    legacyText[s].home = await contentText(legacy);
  }
  await legacy.context().close();

  await loadRules(TARGET);
  const page = await newPage(V[1366]);
  for (const s of [SPRING, FALL]) {
    await page.goto(`${BASE}/teams/${TIGERS}/seasons/${s}/trophies/`);
    await page.getByText(/Trophy/i).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    assert.equal(await contentText(page), legacyText[s].trophies, `${s}: trophy case identical`);
    assert.equal(await primary(page), legacyText[s].primary, `${s}: branding identical`);
    await page.goto(`${BASE}/teams/${TIGERS}/seasons/${s}/home/`);
    await page.getByText(s === SPRING ? "Logan Pike" : "Alex Rivera").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    assert.equal(await contentText(page), legacyText[s].home, `${s}: roster, stats, and leaders identical`);
  }
  await shot(page, "F-1366-fall-home");

  // Recognition sheets print exactly as before: one 8×10 page.
  for (const id of ["p01", "p02"]) {
    await page.goto(`${BASE}/teams/${TIGERS}/seasons/${SPRING}/players/${id}/`);
    await page.locator("[data-player-plaque]").waitFor({ timeout: 30000 });
    assert.equal(await page.locator(".recognition-sheet").first().evaluate((el) => el.style.getPropertyValue("--plq-brand").trim()), "#ff4d00");
    await page.emulateMedia({ media: "print" });
    const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
    await page.emulateMedia({ media: "screen" });
    assert.equal((pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length, 1, `${id}: one page`);
    const box = pdf.match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\]/);
    assert.deepEqual([box?.[1], box?.[2]], ["720", "576"], `${id}: 8x10`);
  }
  await shot(page, "F-1366-spring-plaque");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
