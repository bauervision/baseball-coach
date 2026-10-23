// Browser acceptance on the production-shaped fixture (synthetic names; same
// schema, counts, and legacy quirks as the production export), in the state
// after the approved identity migration. Same emulator build as
// seasonSetup.test.mjs (see its header); skipped without BROWSER_BASE_URL.
//
// V  viewing + historical switching + recognition (1366, 1440, 390)
// C  returning-player career continuity (#999 → #500)
// S  current-season stat entry (1366)
// E  player edit (390)
// L  explicit current-season switching, finalize, reopen (1440)
// H  historical records unchanged; printing still one 8×10 page
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { productionShapedSnapshot } from "../support/productionShapedFixture.mjs";

const BASE = process.env.BROWSER_BASE_URL;
const SKIP = !BASE && "set BROWSER_BASE_URL";
const PROJECT = "demo-baseball-coach";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const COACH = "coach-mike";
const SPRING = "tigers-2026";
const FALL = "tigers-fall-2026";
const VIEWPORTS = [
  ["1366", { width: 1366, height: 768 }, false],
  ["1440", { width: 1440, height: 900 }, false],
  ["390", { width: 390, height: 844 }, true],
];

let browser;
let db;
let springBefore;

async function seasonTree(id) {
  const ref = db.doc(`seasons/${id}`);
  const out = { data: (await ref.get()).data() };
  for (const sub of ["players", "games", "lineups"]) {
    const q = await ref.collection(sub).get();
    out[sub] = {};
    for (const d of q.docs) {
      out[sub][d.id] = d.data();
      if (sub === "games") out[sub][d.id].lines = (await d.ref.collection("lines").get()).docs.map((l) => [l.id, l.data()]);
    }
  }
  return JSON.parse(JSON.stringify(out));
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
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  await getAuth().createUser({ uid: COACH, email: "coach@example.test", password: "fixture-pass-123" });
  const snap = productionShapedSnapshot({ migrated: true });
  const batch = db.batch();
  batch.set(db.doc(`admins/${COACH}`), snap.admins);
  batch.set(db.doc("app/config"), snap.config);
  for (const s of snap.seasons) {
    const sref = db.doc(`seasons/${s.seasonId}`);
    batch.set(sref, s.data);
    for (const p of s.players) batch.set(sref.collection("players").doc(p.id), p.data);
    for (const g of s.games) {
      const gref = sref.collection("games").doc(g.id);
      batch.set(gref, g.data);
      for (const l of g.lines) batch.set(gref.collection("lines").doc(l.id), l.data);
    }
    for (const l of s.lineups) batch.set(sref.collection("lineups").doc(l.id), l.data);
  }
  await batch.commit();
  springBefore = await seasonTree(SPRING);
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

async function newPage(viewport, mobile, role) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
  const session = role === "admin"
    ? { role: "admin", email: "coach@example.test", uid: COACH, name: "Coach" }
    : { role: "public", name: "Parent" };
  await ctx.addInitScript((s) => localStorage.setItem("baseball-coach:session", JSON.stringify(s)), session);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  return page;
}

async function coachPage(viewport, mobile = false) {
  const page = await newPage(viewport, mobile, "admin");
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

async function noOverflow(page, label) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `${label}: horizontal overflow ${sw} > ${cw}`);
}

const primary = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
const config = async () => (await db.doc("app/config").get()).data().currentSeasonId;

for (const [tag, viewport, mobile] of VIEWPORTS) {
  test(`V: current and historical seasons, switching, recognition (${tag})`, { skip: SKIP }, async () => {
    const page = await newPage(viewport, mobile, "public");
    await page.goto(`${BASE}/`);
    await page.getByText("Alex Rivera").first().waitFor({ timeout: 30000 });
    assert.match(await page.locator("footer").innerText(), /Tigers\s+Mustang\s+Fall 2026|Tigers.*Fall 2026/);
    assert.equal(await primary(page), "#ff4d00", "legacy Tigers branding");
    await noOverflow(page, `${tag} home`);

    // Historical switching via the season selector.
    await page.getByLabel("Season", { exact: true }).selectOption(SPRING);
    await page.waitForURL(/season=tigers-2026/);
    await page.getByText("Logan Pike").first().waitFor({ timeout: 30000 });
    assert.match(await page.locator("footer").innerText(), /Spring 2026/, "legacy doc without labels reads Spring 2026");
    assert.equal(await primary(page), "#ff4d00");
    await noOverflow(page, `${tag} spring`);

    // Recognition sheet (Spring is in end-of-season mode, as in production;
    // Fall is still in progress and shows season stats).
    await page.goto(`${BASE}/player/?id=p01&season=${SPRING}`);
    await page.locator("[data-player-plaque]").waitFor({ timeout: 30000 });
    assert.equal(await page.locator(".recognition-sheet").first().evaluate((el) => el.style.getPropertyValue("--plq-brand").trim()), "#ff4d00");
    await noOverflow(page, `${tag} plaque`);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

test("C: a returning player's career spans Spring #999 and Fall #500 (1366)", { skip: SKIP }, async () => {
  const page = await newPage({ width: 1366, height: 768 }, false, "public");
  await page.goto(`${BASE}/player/?id=500-blake-turner&season=${FALL}`);
  const careerBtn = page.getByRole("button", { name: /Career Stats/ });
  await careerBtn.waitFor({ timeout: 30000 });
  await careerBtn.click();
  await page.getByText(/GAMES PLAYED\s*19/i).waitFor({ timeout: 20000 }); // 9 Spring + 10 Fall
  const options = (await page.getByLabel("Season", { exact: true }).locator("option").allInnerTexts()).join(" | ");
  assert.match(options, /Spring 2026 — Tigers/, "legacy Spring label");
  assert.match(options, /Fall 2026 — Tigers/);
  assert.doesNotMatch(await page.locator("body").innerText(), /Season — Team|Team Season/, "never generic defaults");
  // A Spring-only player has no career toggle (nothing linked by name).
  await page.goto(`${BASE}/player/?id=p05&season=${SPRING}`);
  await page.locator("[data-player-plaque]").waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole("button", { name: /Career Stats/ }).count(), 0);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test("S: current-season stat entry updates the game, lines, and totals (1366)", { skip: SKIP }, async () => {
  const before = (await db.doc(`seasons/${FALL}/players/21-alex-rivera`).get()).data().stats;
  const page = await coachPage({ width: 1366, height: 768 });
  await page.getByRole("button", { name: "Stat Update", exact: true }).click();
  await page.getByRole("textbox", { name: "Opponent" }).fill("Fixture Bears");
  await page.getByRole("textbox", { name: "Date" }).fill("2026-11-07");
  await page.getByRole("textbox", { name: "Us" }).fill("6");
  await page.getByRole("textbox", { name: "Them" }).fill("4");
  const row = page.locator("div.rounded-2xl.border.p-4", { hasText: "Alex Rivera" }).first();
  await row.getByRole("textbox", { name: "AB", exact: true }).fill("3");
  await row.getByRole("textbox", { name: "H", exact: true }).fill("2");
  await page.getByRole("button", { name: "Save game" }).click();
  await page.getByText(/Saved game vs Fixture Bears/).waitFor({ timeout: 20000 });
  const games = await db.collection(`seasons/${FALL}/games`).where("opponent", "==", "Fixture Bears").get();
  assert.equal(games.size, 1);
  const after = (await db.doc(`seasons/${FALL}/players/21-alex-rivera`).get()).data().stats;
  assert.equal(after.hits, before.hits + 2);
  assert.equal(after.atBats, before.atBats + 3);
  await noOverflow(page, "1366 stat entry");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test("E: player edit saves only that player (390)", { skip: SKIP }, async () => {
  const page = await coachPage({ width: 390, height: 844 }, true);
  await page.getByRole("button", { name: "Player Update", exact: true }).click();
  const number = page.getByRole("textbox", { name: "Number" }).nth(0);
  await number.waitFor({ timeout: 20000 });
  const name = await page.getByRole("textbox", { name: "Name" }).nth(0).inputValue();
  await number.fill("13");
  await page.getByRole("button", { name: "Save player changes" }).click();
  await page.getByText(/Saved changes for 1 player/).waitFor({ timeout: 20000 });
  const q = await db.collection(`seasons/${FALL}/players`).where("name", "==", name).get();
  assert.equal(String(q.docs[0].data().number), "13");
  await noOverflow(page, "390 player edit");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test("L: explicit current-season switching, finalize, and reopen (1440)", { skip: SKIP }, async () => {
  const page = await coachPage({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Season Update", exact: true }).click();

  // Switching is explicit and reversible.
  await page.getByRole("combobox", { name: "Season to make current" }).selectOption(SPRING);
  assert.equal(await config(), FALL, "selecting alone changes nothing");
  await page.getByRole("button", { name: "Make current", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Current season id: tigers-2026"), null, { timeout: 20000 });
  assert.equal(await config(), SPRING);
  await page.getByRole("combobox", { name: "Season to make current" }).selectOption(FALL);
  await page.getByRole("button", { name: "Make current", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Current season id: tigers-fall-2026"), null, { timeout: 20000 });
  assert.equal(await config(), FALL);

  // Finalize Spring 2026 with the checklist, then reopen it.
  await page.getByRole("combobox", { name: "Season to finalize or reopen" }).selectOption(SPRING);
  const checklist = page.locator("label").filter({ has: page.getByRole("checkbox") }).filter({ hasText: /reviewed|selected or skipped|confirmed/ });
  for (const box of await checklist.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Finalize season…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Finalize season" }).click();
  await page.getByRole("button", { name: "Reopen season…" }).waitFor({ timeout: 20000 });
  assert.equal((await db.doc(`seasons/${SPRING}`).get()).data().status, "finalized");
  await page.waitForFunction(
    (id) => document.querySelector(`select[aria-label="Season to make current"] option[value="${id}"]`)?.disabled === true,
    SPRING,
    { timeout: 15000 },
  ); // a finalized season cannot be made current

  await page.getByRole("button", { name: "Reopen season…" }).click();
  const reopen = page.getByRole("alertdialog");
  assert.equal(await reopen.getByRole("button", { name: "Reopen season" }).isDisabled(), true, "reopen needs acknowledgement");
  await reopen.getByRole("checkbox", { name: /records will be editable/ }).check();
  await reopen.getByRole("button", { name: "Reopen season" }).click();
  await page.getByRole("button", { name: "Finalize season…" }).waitFor({ timeout: 20000 });
  const spring = (await db.doc(`seasons/${SPRING}`).get()).data();
  assert.equal(spring.status, "active");
  assert.deepEqual(spring.lifecycleHistory.map((e) => e.action), ["finalized", "reopened"]);
  assert.equal(await config(), FALL, "reopen never changes the current season");
  await noOverflow(page, "1440 lifecycle");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test("H: Spring 2026 records unchanged except lifecycle fields; sheets print as one 8×10 page", { skip: SKIP }, async () => {
  const now = await seasonTree(SPRING);
  const lifecycle = ["status", "finalizedAt", "finalizedByUid", "reopenedAt", "reopenedByUid", "lifecycleHistory", "updatedAt"];
  for (const k of lifecycle) {
    delete now.data[k];
    delete springBefore.data[k];
  }
  assert.deepEqual(now, springBefore, "players, stats, games, lines, lineups, awards, legacy fields");

  const page = await newPage({ width: 1366, height: 768 }, false, "public");
  for (const [season, id] of [[SPRING, "p01"], [SPRING, "p02"]]) {
    await page.goto(`${BASE}/player/?id=${id}&season=${season}`);
    await page.locator("[data-player-plaque]").waitFor({ timeout: 30000 });
    await page.emulateMedia({ media: "print" });
    const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
    await page.emulateMedia({ media: "screen" });
    assert.equal((pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length, 1, `${season}: one page`);
    const box = pdf.match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\]/);
    assert.deepEqual([box?.[1], box?.[2]], ["720", "576"], `${season}: 8x10`);
  }
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
