// Google sign-in, invitations, and coach workspaces in the browser (emulator
// build only, through the production guard). Google is driven by the
// emulator-only test credential seam (window.__bcTestGoogleIdToken) because
// Firebase's real popup loads apis.google.com, which the guard blocks; this
// is NOT a production Google OAuth test. Skipped without BROWSER_BASE_URL.
//
// A  legacy password coach links Google; UID unchanged; access kept (390)
// B  approved new coach: Google → invite accepted → one empty workspace,
//    restored after reload and in a fresh browser (1440)
// C  unapproved Google user: Access not enabled, sign out (1366/1440/390/360)
// D  isolation: each coach sees only their own teams (1366)
// E  flags off: the existing login and Admin are unchanged (360)
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { assertNoExternalRequests, launchGuardedBrowser } from "./support/guard.mjs";
import { productionShapedSnapshot } from "../support/productionShapedFixture.mjs";
import { LEGACY_TIGERS_BRANDING } from "../../src/lib/branding.ts";

const BASE = process.env.BROWSER_BASE_URL;
const SKIP = !BASE && "set BROWSER_BASE_URL";
const PROJECT = "demo-baseball-coach";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const ORIGINAL = { uid: "coach-mike", email: "coach@example.test" };
const NEW_EMAIL = "new.coach@gmail.com";
const STRANGER_EMAIL = "stranger@gmail.com";
const TARGET = fs.readFileSync("firestore.target.rules", "utf8");
const REPO = fs.readFileSync("firestore.rules", "utf8");

let browser;
let db;
let auth;

async function loadRules(content) {
  const res = await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: "PUT",
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }),
  });
  if (!res.ok) throw new Error(`rules load failed: ${res.status}`);
}

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
  await auth.createUser({ uid: ORIGINAL.uid, email: ORIGINAL.email, password: "fixture-pass-123" });
  const snap = productionShapedSnapshot({ migrated: true });
  const batch = db.batch();
  batch.set(db.doc(`admins/${ORIGINAL.uid}`), snap.admins);
  batch.set(db.doc("app/config"), snap.config);
  for (const s of snap.seasons) {
    const sref = db.doc(`seasons/${s.seasonId}`);
    batch.set(sref, { ...s.data, ownerUid: ORIGINAL.uid });
    for (const p of s.players) batch.set(sref.collection("players").doc(p.id), p.data);
    for (const g of s.games) batch.set(sref.collection("games").doc(g.id), g.data);
  }
  // The original coach after the workspace migration (as tools/coach-workspace-migrate.mjs writes it).
  batch.set(db.doc("coachInvites/inv_original"), { emailLower: ORIGINAL.email, status: "accepted", boundUid: ORIGINAL.uid, issuedBy: "migration", createdAt: new Date() });
  batch.set(db.doc("coachWorkspaces/ws_original"), { ownerUid: ORIGINAL.uid, status: "active", createdAt: new Date() });
  batch.set(db.doc(`coaches/${ORIGINAL.uid}`), { workspaceId: "ws_original", inviteId: "inv_original", status: "active", createdAt: new Date() });
  batch.set(db.doc("teams/falcons-0001"), { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "falcons-0001", teamName: "Falcons", ownerUid: ORIGINAL.uid, workspaceId: "ws_original", createdAt: new Date(), updatedAt: new Date() });
  batch.set(db.doc("coachInvites/inv_new"), { emailLower: NEW_EMAIL, status: "approved", boundUid: null, issuedBy: "owner-cli", createdAt: new Date() });
  await batch.commit();
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

async function newPage(viewport, { flags = {}, googleEmail = null, session = null } = {}) {
  const mobile = viewport.width < 500;
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
  await ctx.addInitScript(
    ({ flags, token, session }) => {
      for (const [k, v] of Object.entries(flags)) localStorage.setItem(`bc:feature:${k}`, v ? "1" : "0");
      if (token) window.__bcTestGoogleIdToken = token;
      if (session && !sessionStorage.getItem("bc-test-seeded")) {
        localStorage.setItem("baseball-coach:session", JSON.stringify(session));
        sessionStorage.setItem("bc-test-seeded", "1");
      }
    },
    { flags, token: googleEmail ? googleToken(googleEmail) : null, session },
  );
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  return page;
}

async function noOverflow(page, label) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `${label}: horizontal overflow ${sw} > ${cw}`);
}

/** Tallies sign-in → Continue with Google → lands on /admin/. */
async function signInWithGoogleUi(page) {
  await page.goto(`${BASE}/signin/`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL(/\/admin\/?$/, { timeout: 30000 });
}

const gate = (page) => page.locator("[data-coach-gate]");
const teamIds = (page) => page.locator("[data-team-link-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-team-link-row")));
// The coach area is neutral: no legacy team/season labels, no raw rules errors.
async function neutralShell(page, label) {
  const body = await page.locator("body").innerText();
  assert.doesNotMatch(body, /evaluation error|insufficient permissions|PERMISSION_DENIED/i, `${label}: no raw errors`);
  assert.doesNotMatch(body, /Mustang Tigers|Spring 2026|Fall 2026/, `${label}: no legacy team/season labels`);
  assert.match(await page.locator("header").first().innerText(), /tallies/);
}

test("A: the original password coach links Google; UID and access are unchanged (390)", { skip: SKIP }, async () => {
  await loadRules(REPO);
  const page = await newPage({ width: 390, height: 844 }, { flags: { googleLink: true }, googleEmail: ORIGINAL.email, session: { role: "admin", email: ORIGINAL.email, uid: ORIGINAL.uid, name: "Coach" } });
  await page.goto(`${BASE}/admin/`);
  const ready = page.locator('[data-admin-ready="true"]');
  await ready.or(page.getByLabel("Email")).first().waitFor({ timeout: 30000 });
  if (!(await ready.isVisible())) {
    await page.getByLabel("Email").fill(ORIGINAL.email);
    await page.getByLabel("Password").fill("fixture-pass-123");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await ready.waitFor({ timeout: 30000 });
  assert.deepEqual((await auth.getUser(ORIGINAL.uid)).providerData.map((p) => p.providerId), ["password"]);

  await page.getByRole("button", { name: "Link Google account" }).click();
  await page.getByText("Google is linked. Your account is unchanged, and your password still works.").waitFor({ timeout: 20000 });
  const after = await auth.getUser(ORIGINAL.uid);
  assert.deepEqual(after.providerData.map((p) => p.providerId).sort(), ["google.com", "password"], "UID kept; password kept");
  assert.equal((await auth.listUsers()).users.filter((u) => u.email === ORIGINAL.email).length, 1, "no replacement account");

  await page.reload();
  await ready.waitFor({ timeout: 30000 });
  await page.getByText("Google sign-in is linked to this account.").waitFor({ timeout: 20000 });
  assert.match(await page.locator("[data-admin-context]").innerText(), /Fall 2026/);
  await noOverflow(page, "390 linked admin");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test("B: an approved new coach gets one empty workspace, restored on return (1440)", { skip: SKIP }, async () => {
  await loadRules(TARGET);
  const page = await newPage({ width: 1440, height: 900 }, { flags: { multiCoach: true }, googleEmail: NEW_EMAIL });
  await signInWithGoogleUi(page);
  await page.locator('[data-coach-gate="approved"]').waitFor({ timeout: 30000 });
  await page.locator("[data-empty-workspace]").waitFor({ timeout: 20000 });
  assert.match(await gate(page).innerText(), /Your workspace[\s\S]*Signed in as new\.coach@gmail\.com/);
  const ws = await gate(page).getAttribute("data-workspace-id");
  const user = await auth.getUserByEmail(NEW_EMAIL);
  assert.deepEqual((await db.doc(`coaches/${user.uid}`).get()).data().workspaceId, ws);
  assert.equal((await db.doc("coachInvites/inv_new").get()).data().boundUid, user.uid);
  assert.doesNotMatch(await page.locator("main").first().innerText(), /Falcons|Tigers Spring|Alex Rivera/, "no other coach's data");
  await neutralShell(page, "1440 workspace");

  await page.reload();
  await page.locator('[data-coach-gate="approved"]').waitFor({ timeout: 30000 });
  assert.equal(await gate(page).getAttribute("data-workspace-id"), ws, "restored after refresh");
  await noOverflow(page, "1440 workspace");
  await page.context().close();

  const again = await newPage({ width: 1440, height: 900 }, { flags: { multiCoach: true }, googleEmail: NEW_EMAIL });
  await signInWithGoogleUi(again);
  await again.locator('[data-coach-gate="approved"]').waitFor({ timeout: 30000 });
  assert.equal(await gate(again).getAttribute("data-workspace-id"), ws, "same workspace in a fresh browser");
  assert.equal((await db.collection("coachWorkspaces").where("ownerUid", "==", user.uid).get()).size, 1);
  assert.deepEqual(again.errors, []);
  await again.context().close();
});

for (const [tag, viewport] of [["1366", { width: 1366, height: 768 }], ["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }], ["360", { width: 360, height: 780 }]]) {
  test(`C: an unapproved Google user sees Access not enabled and can sign out (${tag})`, { skip: SKIP }, async () => {
    await loadRules(TARGET);
    const page = await newPage(viewport, { flags: { multiCoach: true }, googleEmail: STRANGER_EMAIL });
    await signInWithGoogleUi(page);
    await page.locator('[data-coach-gate="notApproved"]').waitFor({ timeout: 30000 });
    const text = await page.locator("main").first().innerText();
    assert.match(text, /Access not enabled/);
    assert.doesNotMatch(text, /Falcons|Tigers|Alex Rivera|Stat Update|new\.coach/, "no team, roster, admin, or invite details");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Access not enabled", "focus moves to the heading");
    await neutralShell(page, `${tag} access not enabled`);
    const uid = (await auth.getUserByEmail(STRANGER_EMAIL)).uid;
    assert.equal((await db.doc(`coaches/${uid}`).get()).exists, false, "no coach record");
    assert.equal((await db.collection("coachWorkspaces").where("ownerUid", "==", uid).get()).size, 0, "no workspace");
    await noOverflow(page, `${tag} access not enabled`);
    await gate(page).getByRole("button", { name: "Sign out" }).click();
    await page.locator('[data-coach-gate="signedOut"]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-coach-gate="approved"], [data-coach-gate="notApproved"]').count(), 0, "protected UI gone after sign-out");
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

test("D: each coach sees only their own workspace teams (1366)", { skip: SKIP }, async () => {
  await loadRules(TARGET);
  const nUid = (await auth.getUserByEmail(NEW_EMAIL)).uid;
  const nWs = (await db.doc(`coaches/${nUid}`).get()).data().workspaceId;
  await db.doc("teams/hawks-0001").set({ ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "hawks-0001", teamName: "Hawks", ownerUid: nUid, workspaceId: nWs, createdAt: new Date(), updatedAt: new Date() });

  const n = await newPage({ width: 1366, height: 768 }, { flags: { multiCoach: true }, googleEmail: NEW_EMAIL });
  await signInWithGoogleUi(n);
  await n.getByRole("list", { name: "Your teams" }).waitFor({ timeout: 30000 });
  assert.deepEqual(await teamIds(n), ["hawks-0001"]);
  await n.context().close();

  // The original coach signs in with the password fallback (Google linked in A).
  const o = await newPage({ width: 1366, height: 768 }, { flags: { multiCoach: true } });
  await o.goto(`${BASE}/signin/`);
  await o.getByRole("button", { name: "Use email and password instead" }).click();
  await o.getByLabel("Email").fill(ORIGINAL.email);
  await o.getByLabel("Password").fill("fixture-pass-123");
  await o.getByRole("button", { name: "Sign in", exact: true }).click();
  await o.waitForURL(/\/admin\/?$/, { timeout: 30000 });
  await o.getByRole("list", { name: "Your teams" }).waitFor({ timeout: 30000 });
  assert.deepEqual(await teamIds(o), ["falcons-0001"]);
  assert.equal(await gate(o).getAttribute("data-workspace-id"), "ws_original");
  assert.deepEqual(o.errors, []);
  await o.context().close();
});

test("E: with the flags off, the existing login and Admin are unchanged (360)", { skip: SKIP }, async () => {
  await loadRules(REPO);
  const page = await newPage({ width: 360, height: 780 });
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Coach Login" }).click();
  await page.getByPlaceholder("Email").waitFor({ timeout: 10000 });
  assert.equal(await page.getByRole("button", { name: "Continue with Google" }).count(), 0, "no Google sign-in");
  await page.getByPlaceholder("Email").fill(ORIGINAL.email);
  await page.getByPlaceholder("Password").fill("fixture-pass-123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/admin/`);
  await page.locator('[data-admin-ready="true"]').waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole("button", { name: "Link Google account" }).count(), 0, "no linking UI");
  assert.equal(await page.locator("[data-coach-gate]").count(), 0, "no workspace gate");
  assert.match(await page.locator("[data-admin-context]").innerText(), /Mustang Tigers · Fall 2026/);
  await noOverflow(page, "360 legacy admin");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
