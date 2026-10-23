// Browser regression for "Missing or insufficient permissions." in New
// Season Setup → Team step. Same emulator build as seasonSetup.test.mjs
// (see its header); skipped when BROWSER_BASE_URL is not set.
//
// P: rules without /teams (an outdated deployment) — the Team step says
//    why teams are unavailable instead of a silent empty list, and a failed
//    Create shows an actionable message, not the SDK's generic text.
// V: repo rules — Blank and Original Tigers look both create and reach the
//    Season step; choosing an existing team works (1366, 1440, 390).
// S: Season → Roster → Ready smoke for a created team.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { legacySnapshot } from "../support/fixtures.mjs";

const BASE = process.env.BROWSER_BASE_URL;
const SKIP = !BASE && "set BROWSER_BASE_URL";
const PROJECT = "demo-baseball-coach";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const COACH = "coach-mike";
const GENERIC = /Missing or insufficient permissions/;
const ACTIONABLE = /security rules do not allow this account to read or save teams/;

const REPO_RULES = fs.readFileSync("firestore.rules", "utf8");
const RULES_WITHOUT_TEAMS = REPO_RULES.replace(
  /    match \/teams\/\{teamId\} \{[\s\S]*?allow delete: if false;\n    \}\n/,
  "",
);

let browser;
let db;
let historyBefore;

async function loadRules(content) {
  const res = await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: "PUT",
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }),
  });
  if (!res.ok) throw new Error(`rules load failed: ${res.status}`);
}

async function historyFingerprint() {
  const out = [JSON.stringify((await db.doc("app/config").get()).data())];
  for (const id of ["tigers-2026", "tigers-fall-2026"]) {
    const ref = db.doc(`seasons/${id}`);
    out.push(JSON.stringify((await ref.get()).data()));
    for (const sub of ["players", "games"]) {
      const q = await ref.collection(sub).get();
      for (const d of q.docs.sort((a, b) => a.id.localeCompare(b.id))) out.push(`${sub}/${d.id}:${JSON.stringify(d.data())}`);
    }
  }
  return out.join("\n");
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
  await loadRules(REPO_RULES);
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  await getAuth().createUser({ uid: COACH, email: "coach@example.test", password: "fixture-pass-123" });
  const snap = legacySnapshot();
  const batch = db.batch();
  batch.set(db.doc(`admins/${COACH}`), { role: "coach" });
  batch.set(db.doc("app/config"), snap.config);
  for (const s of snap.seasons) {
    const sref = db.doc(`seasons/${s.seasonId}`);
    batch.set(sref, { ...s.data, league: "Mustang" });
    for (const p of s.players) batch.set(sref.collection("players").doc(p.id), p.data);
    for (const g of s.games) batch.set(sref.collection("games").doc(g.id), g.data);
  }
  await batch.commit();
  historyBefore = await historyFingerprint();
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
});

after(async () => {
  if (BASE) await loadRules(REPO_RULES);
  await browser?.close();
});

async function coachPage(viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
  await ctx.addInitScript(() =>
    localStorage.setItem("baseball-coach:session", JSON.stringify({ role: "admin", email: "coach@example.test", uid: "coach-mike", name: "Coach" })),
  );
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(`${BASE}/admin/`);
  const signed = page.getByText("Signed in and allowlisted.");
  const email = page.getByLabel("Email");
  await signed.or(email).first().waitFor({ timeout: 30000 });
  if (!(await signed.isVisible())) {
    await email.fill("coach@example.test");
    await page.getByLabel("Password").fill("fixture-pass-123");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await signed.waitFor({ timeout: 30000 });
  return page;
}

async function startSetup(page) {
  await page.getByRole("button", { name: "Season Update" }).click();
  await page.getByRole("button", { name: "Start setup" }).click();
  await page.waitForURL(/setup=1&step=team/);
  await page.getByRole("radiogroup", { name: "Team" }).waitFor({ timeout: 30000 });
}

async function noOverflow(page, label) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `${label}: horizontal overflow ${sw} > ${cw}`);
}

async function fillBlankFalcons(page) {
  await page.getByRole("radio", { name: "Create a new team" }).check();
  await page.getByRole("radio", { name: "Blank team" }).check();
  await page.getByLabel("Team name").fill("Falcons");
  await page.getByLabel("Short name").fill("FAL");
  await page.getByLabel("Division / age group").fill("10U");
  await page.getByRole("button", { name: /^Softball/ }).click();
  await page.getByRole("button", { name: /^Tigers D/ }).click(); // bundled logo
}

const teamDoc = async (id) => (await db.doc(`teams/${id}`).get()).data();
const urlTeam = (page) => new URL(page.url()).searchParams.get("team");

test("P: rules without /teams → actionable message on load and on Create; nothing written (1366)", { skip: SKIP }, async () => {
  await loadRules(RULES_WITHOUT_TEAMS);
  try {
    const page = await coachPage({ width: 1366, height: 768 });
    await startSetup(page);
    const alert = page.getByRole("alert").filter({ hasText: ACTIONABLE });
    await alert.waitFor({ timeout: 20000 });
    await fillBlankFalcons(page);
    await page.getByRole("button", { name: "Create team" }).first().click();
    await page.getByText(ACTIONABLE).nth(1).waitFor({ timeout: 20000 }); // load alert + save error
    assert.match(page.url(), /step=team/, "stays on the Team step");
    assert.doesNotMatch(await page.locator("body").innerText(), GENERIC);
    assert.equal((await db.collection("teams").get()).size, 0, "nothing written");
    await noOverflow(page, "1366 denied");
    assert.deepEqual(page.errors, []);
    await page.context().close();
  } finally {
    await loadRules(REPO_RULES);
  }
});

for (const [tag, viewport, mobile] of [
  ["1366", { width: 1366, height: 768 }, false],
  ["1440", { width: 1440, height: 900 }, false],
  ["390", { width: 390, height: 844 }, true],
]) {
  test(`V: Blank → Falcons softball, Original Tigers look, existing team — all reach Season (${tag})`, { skip: SKIP }, async () => {
    const page = await coachPage(viewport, mobile);
    await startSetup(page);
    const body = await page.locator("body").innerText();
    assert.doesNotMatch(body, ACTIONABLE, "no error before anything failed");
    assert.doesNotMatch(body, GENERIC);

    await fillBlankFalcons(page);
    await noOverflow(page, `${tag} blank`);
    await page.getByRole("button", { name: "Create team" }).first().click();
    await page.waitForURL(/step=season&team=falcons-/, { timeout: 20000 });
    const falcons = await teamDoc(urlTeam(page));
    assert.equal(falcons.teamName, "Falcons");
    assert.equal(falcons.sport, "softball");
    assert.deepEqual(falcons.logo, { kind: "bundled", id: "tigers" });
    await noOverflow(page, `${tag} season`);

    await page.goto(`${BASE}/admin/?setup=1&step=team`);
    await page.getByRole("radiogroup", { name: "Team" }).waitFor({ timeout: 30000 });
    await page.getByRole("radio", { name: "Create a new team" }).check();
    await page.getByRole("radio", { name: "Original Tigers look" }).check();
    await page.getByLabel("Team name").waitFor();
    assert.equal(await page.getByLabel("Team name").inputValue(), "Tigers");
    await noOverflow(page, `${tag} tigers look`);
    await page.getByRole("button", { name: "Create team" }).first().click();
    await page.waitForURL(/step=season&team=tigers-/, { timeout: 20000 });
    const tigers = await teamDoc(urlTeam(page));
    assert.equal(tigers.sport, "baseball");
    assert.equal(tigers.palettes.dark.primary, "#ff4d00");
    assert.deepEqual(tigers.logo, { kind: "bundled", id: "tigers" });

    // Existing team selection.
    const falconsId = falcons.teamId;
    await page.goto(`${BASE}/admin/?setup=1&step=team`);
    await page.getByRole("radiogroup", { name: "Team" }).waitFor({ timeout: 30000 });
    await page.getByRole("radio", { name: "Use an existing team" }).check();
    await page.getByRole("button", { name: /^Falcons/ }).first().click();
    await page.waitForURL(/team=falcons-/);
    await page.getByRole("button", { name: "Next: Season" }).click();
    await page.waitForURL(/step=season&team=falcons-/);
    assert.ok(urlTeam(page).startsWith("falcons-"));
    assert.ok(falconsId);

    assert.doesNotMatch(await page.locator("body").innerText(), GENERIC);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

test("S: created team → draft season → roster → Ready; current season and history unchanged (1366)", { skip: SKIP }, async () => {
  const falcons = (await db.collection("teams").where("teamName", "==", "Falcons").get()).docs[0].data();
  const page = await coachPage({ width: 1366, height: 768 });
  await page.goto(`${BASE}/admin/?setup=1&step=season&team=${falcons.teamId}`);
  await page.getByRole("combobox", { name: "Season term" }).waitFor({ timeout: 30000 });
  await page.getByRole("combobox", { name: "Season term" }).selectOption("Spring");
  await page.getByRole("textbox", { name: "Season year" }).fill("2027");
  await page.getByRole("button", { name: "Create draft season" }).click();
  await page.waitForURL(/step=roster/, { timeout: 20000 });
  const seasonId = new URL(page.url()).searchParams.get("setupSeason");
  const s = (await db.doc(`seasons/${seasonId}`).get()).data();
  assert.equal(s.status, "draft");
  assert.equal(s.teamId, falcons.teamId);
  for (const k of ["teamName", "shortName", "sport", "division", "logo", "palettes", "awardCollection"]) {
    assert.deepEqual(s.branding[k], falcons[k], `snapshot ${k}`);
  }

  await page.getByRole("button", { name: "Add new player" }).click();
  await page.getByLabel("Name").last().fill("Kai New");
  await page.getByRole("button", { name: /^Add 1 to Spring 2027/ }).click();
  await page.getByText(/Added 1 player to/).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Next: Ready" }).click();
  await page.waitForURL(/step=ready/);
  assert.match(await page.getByRole("list", { name: "Readiness" }).innerText(), /Roster\s+1 player/);
  await noOverflow(page, "1366 ready");

  assert.equal((await db.doc(`seasons/${seasonId}`).get()).data().status, "draft");
  assert.equal((await db.doc("app/config").get()).data().currentSeasonId, "tigers-fall-2026");
  assert.equal(await historyFingerprint(), historyBefore, "historical Tigers data unchanged");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
