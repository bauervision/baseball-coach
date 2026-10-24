// Admin workspace header + draft season deletion (emulator only).
// Same emulator build as seasonSetup.test.mjs (see its header); skipped
// without BROWSER_BASE_URL. Production-shaped fixture, synthetic names.
//
// A  header: groups, active state, context, themes, sizes (1366/1440/390/360)
// B  delete a disposable draft with roster entries through the UI (1440)
// D  setup no longer offers it; a replacement draft works (1366)
// C  active/finalized/legacy seasons: not offered, and rejected by rules
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { PS_IDS, productionShapedSnapshot } from "../support/productionShapedFixture.mjs";
import { LEGACY_TIGERS_BRANDING } from "../../src/lib/branding.ts";

const BASE = process.env.BROWSER_BASE_URL;
const SKIP = !BASE && "set BROWSER_BASE_URL";
const PROJECT = "demo-baseball-coach";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const COACH = "coach-mike";
const SPRING = "tigers-2026";
const FALL = "tigers-fall-2026";
const DRAFT = "tigers-spring-2027";

let browser;
let db;
let historyBefore;

async function history() {
  const out = [];
  for (const id of [SPRING, FALL]) {
    const ref = db.doc(`seasons/${id}`);
    const data = { ...(await ref.get()).data() };
    for (const k of ["status", "finalizedAt", "finalizedByUid", "lifecycleHistory", "updatedAt"]) delete data[k];
    out.push(JSON.stringify(data));
    for (const sub of ["players", "games", "lineups"]) {
      for (const d of (await ref.collection(sub).get()).docs) out.push(`${id}/${sub}/${d.id}:${JSON.stringify(d.data())}`);
    }
  }
  return out.sort().join("\n");
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
  batch.set(db.doc("teams/tigers-0001"), { ...structuredClone(LEGACY_TIGERS_BRANDING), teamId: "tigers-0001", createdAt: new Date(), updatedAt: new Date() });
  // A returning player who is the coach's linked child (My Players).
  batch.set(db.doc(`playerIdentities/${PS_IDS.alex}`), { careerPlayerId: PS_IDS.alex, displayName: "Alex Rivera", managerUids: [COACH], createdByUid: COACH, createdAt: new Date(), updatedAt: new Date() });
  batch.set(db.doc(`coachProfiles/${COACH}/linkedPlayers/${PS_IDS.alex}`), { careerPlayerId: PS_IDS.alex, displayName: "Alex Rivera", relationship: "child", confirmed: true, linkedAt: new Date() });
  await batch.commit();
  historyBefore = await history();
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
});

after(async () => {
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
  const ready = page.locator('[data-admin-ready="true"]');
  const email = page.getByLabel("Email");
  await ready.or(email).first().waitFor({ timeout: 30000 });
  if (!(await ready.isVisible())) {
    await email.fill("coach@example.test");
    await page.getByLabel("Password").fill("fixture-pass-123");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await ready.waitFor({ timeout: 30000 });
  return page;
}

async function noOverflow(page, label) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `${label}: horizontal overflow ${sw} > ${cw}`);
}

const header = (page) => page.locator('header[aria-label="Admin workspace"]');
const coaching = (page) => page.getByRole("group", { name: "Coaching" });
const management = (page) => page.getByRole("group", { name: "Team and season management" });
const config = async () => (await db.doc("app/config").get()).data().currentSeasonId;

for (const [tag, viewport, mobile, maxHeight] of [
  ["1366", { width: 1366, height: 768 }, false, 130],
  ["1440", { width: 1440, height: 900 }, false, 130],
  ["390", { width: 390, height: 844 }, true, 190],
  ["360", { width: 360, height: 780 }, true, 190],
]) {
  test(`A: workspace header — groups, active state, context, themes (${tag})`, { skip: SKIP }, async () => {
    const page = await coachPage(viewport, mobile);
    const h = header(page);
    assert.equal(await h.locator("[data-admin-context]").innerText(), "Mustang Tigers · Fall 2026");
    assert.equal(await h.locator("[data-admin-context]").getAttribute("title"), `Current season id: ${FALL}`, "id kept as a diagnostic tooltip");
    const text = await page.locator("main").first().innerText();
    for (const gone of ["Sign in and manage the current season.", "Signed in and allowlisted.", "Current season id:"]) {
      assert.ok(!text.includes(gone), `removed: ${gone}`);
    }
    assert.deepEqual(await coaching(page).getByRole("button").allInnerTexts(), ["Stat Update", "Lineup", "Player Update"]);
    assert.deepEqual(await management(page).getByRole("button").allInnerTexts(), ["Season Update", "Team Designer"]);

    const c = await coaching(page).boundingBox();
    const m = await management(page).boundingBox();
    const nav = await page.getByRole("navigation", { name: "Admin sections" }).boundingBox();
    if (!mobile) {
      assert.ok(Math.abs(c.y - m.y) < 2, "one row on desktop");
      assert.ok(Math.abs(c.x - nav.x) < 2 && Math.abs(m.x + m.width - (nav.x + nav.width)) < 2, "coaching left, management right");
    } else {
      assert.ok(m.y > c.y, "groups stack on phones");
    }
    const hb = await h.boundingBox();
    assert.ok(hb.height <= maxHeight, `${tag}: header ${Math.round(hb.height)}px tall`);
    const ctx = await h.locator("[data-admin-context]").evaluate((el) => el.scrollWidth <= el.clientWidth);
    assert.ok(ctx, `${tag}: team/season context not clipped`);
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('nav[aria-label="Admin sections"] button span.truncate, header a[aria-label="Go to home"] div.truncate')]
        .filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth)
        .map((el) => el.textContent),
    );
    assert.deepEqual(clipped, [], `${tag}: section labels and team title fit`);

    // Active state: aria-current plus a non-color marker, keyboard reachable.
    await coaching(page).getByRole("button", { name: "Lineup" }).focus();
    await page.keyboard.press("Enter");
    const lineup = coaching(page).getByRole("button", { name: "Lineup" });
    await page.waitForFunction(() => document.querySelector('[aria-current="page"]')?.textContent?.includes("Lineup"));
    assert.equal(await page.locator('nav[aria-label="Admin sections"] [aria-current="page"]').count(), 1);
    assert.equal(await lineup.locator("span[aria-hidden='true']").count(), 1, "underline marker");
    assert.equal(await lineup.evaluate((el) => getComputedStyle(el).fontWeight), "700");
    await noOverflow(page, `${tag} header`);

    // Theme compatibility: both themes render the header with theme tokens.
    const bg = () => h.evaluate((el) => getComputedStyle(el).backgroundColor);
    const dark = await bg();
    await page.getByRole("button", { name: /Switch to (light|dark) mode/ }).first().click();
    await page.waitForFunction((d) => getComputedStyle(document.querySelector('header[aria-label="Admin workspace"]')).backgroundColor !== d, dark, { timeout: 5000 });
    assert.notEqual(await bg(), dark);
    assert.equal(await page.locator('nav[aria-label="Admin sections"] [aria-current="page"]').count(), 1);
    await noOverflow(page, `${tag} header light`);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });
}

test("A: the header follows the current season (1440)", { skip: SKIP }, async () => {
  const page = await coachPage({ width: 1440, height: 900 });
  await management(page).getByRole("button", { name: "Season Update" }).click();
  await page.getByRole("combobox", { name: "Season to make current" }).selectOption(SPRING);
  await page.getByRole("button", { name: "Make current", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-admin-context]")?.textContent === "Mustang Tigers · Spring 2026", null, { timeout: 20000 });
  await page.getByRole("combobox", { name: "Season to make current" }).selectOption(FALL);
  await page.getByRole("button", { name: "Make current", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-admin-context]")?.textContent === "Mustang Tigers · Fall 2026", null, { timeout: 20000 });
  assert.equal(await config(), FALL);
  await page.context().close();
});

test("B: delete a disposable draft with roster entries through the UI (1440)", { skip: SKIP }, async () => {
  const page = await coachPage({ width: 1440, height: 900 });
  // Disposable draft via guided setup: linked child (preselected) + a new player.
  await management(page).getByRole("button", { name: "Season Update" }).click();
  await page.getByRole("button", { name: "Start setup" }).click();
  await page.getByRole("button", { name: /^Tigers/ }).click();
  await page.getByRole("button", { name: "Next: Season" }).click();
  await page.getByRole("combobox", { name: "Season term" }).selectOption("Spring");
  await page.getByRole("textbox", { name: "Season year" }).fill("2027");
  await page.getByRole("button", { name: "Create draft season" }).click();
  await page.waitForURL(/step=roster/);
  await page.getByText(/Selected \(1\)/).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Add new player" }).click();
  await page.getByLabel("Name").last().fill("Tess Kerr");
  await page.getByRole("button", { name: /^Add 2 to Spring 2027/ }).click();
  await page.getByText(/Added 2 players/).waitFor({ timeout: 20000 });
  assert.equal((await db.collection(`seasons/${DRAFT}/players`).get()).size, 2);

  await page.getByRole("button", { name: "Exit setup" }).click();
  await page.getByRole("heading", { name: "Draft seasons" }).waitFor({ timeout: 20000 });
  const list = page.getByRole("list", { name: "Draft seasons" });
  assert.deepEqual((await list.getByRole("listitem").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")), ["Tigers · Spring 2027 · Draft Delete draft…"]);
  await list.getByRole("button", { name: "Delete draft Tigers Spring 2027" }).click();

  const dialog = page.getByRole("alertdialog");
  await dialog.getByText(/2 draft roster entries/).waitFor({ timeout: 10000 });
  assert.match(await dialog.innerText(), /Earlier seasons, permanent player identities, linked children, and the Tigers team are not changed/);
  const confirm = dialog.getByRole("button", { name: "Delete draft season" });
  assert.equal(await confirm.isDisabled(), true, "needs the typed label");
  await dialog.getByLabel(/Type “Spring 2027” to confirm/).fill("Spring 2026");
  assert.equal(await confirm.isDisabled(), true, "wrong label keeps it disabled");
  await dialog.getByLabel(/Type “Spring 2027” to confirm/).fill("Spring 2027");
  await confirm.click();
  await page.getByText("Deleted the Tigers Spring 2027 draft and 2 draft roster entries.").waitFor({ timeout: 20000 });
  await page.getByText("No draft seasons.").waitFor({ timeout: 10000 });

  assert.equal((await db.doc(`seasons/${DRAFT}`).get()).exists, false);
  assert.equal((await db.collection(`seasons/${DRAFT}/players`).get()).size, 0);
  assert.ok((await db.doc("teams/tigers-0001").get()).exists, "team kept");
  assert.ok((await db.doc(`playerIdentities/${PS_IDS.alex}`).get()).exists, "identity kept");
  assert.ok((await db.doc(`coachProfiles/${COACH}/linkedPlayers/${PS_IDS.alex}`).get()).exists, "link kept");
  assert.equal(await config(), FALL);
  assert.equal(await history(), historyBefore, "Spring/Fall 2026 unchanged");
  const options = await page.getByRole("combobox", { name: "Season to make current" }).locator("option").allInnerTexts();
  assert.ok(!options.some((o) => o.includes("Spring 2027")), "removed from selectors");
  await noOverflow(page, "1440 draft deletion");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test("D: setup no longer offers the deleted draft; a replacement draft works (1366)", { skip: SKIP }, async () => {
  const page = await coachPage({ width: 1366, height: 768 });
  await page.goto(`${BASE}/admin/?setup=1&step=season&team=tigers-0001`);
  await page.getByRole("combobox", { name: "Season term" }).waitFor({ timeout: 30000 });
  await page.getByRole("combobox", { name: "Season term" }).selectOption("Spring");
  await page.getByRole("textbox", { name: "Season year" }).fill("2027");
  await page.getByText(/Creates Spring 2027 for Tigers as a draft/).waitFor({ timeout: 10000 });
  assert.equal(await page.getByRole("button", { name: /^Resume/ }).count(), 0);
  assert.equal(await page.getByText("Drafts in progress").count(), 0);
  await page.getByRole("button", { name: "Create draft season" }).click();
  await page.waitForURL(/step=roster&team=tigers-0001&setupSeason=tigers-spring-2027/);
  const s = (await db.doc(`seasons/${DRAFT}`).get()).data();
  assert.equal(s.status, "draft");
  assert.equal(await config(), FALL);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test("C: active, finalized, and legacy seasons are not offered and are rejected by rules (1366)", { skip: SKIP }, async () => {
  // Spring 2026 finalized, the replacement draft activated (not current).
  const { initializeApp } = await import("firebase/app");
  const { connectFirestoreEmulator, initializeFirestore, deleteDoc, doc } = await import("firebase/firestore");
  const { deleteDraftSeason, finalizeSeason, makeCurrentSeason } = await import("../../src/app/(protected)/admin/_parts/adminActions.ts");
  const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key" }, "browser-c-coach");
  const cdb = initializeFirestore(app, {});
  const [host, port] = FS_HOST.split(":");
  connectFirestoreEmulator(cdb, host, Number(port), { mockUserToken: { sub: COACH, user_id: COACH } });
  await finalizeSeason({ db: cdb, uid: COACH, seasonId: SPRING });
  await makeCurrentSeason({ db: cdb, seasonId: DRAFT, uid: COACH }); // activates
  await makeCurrentSeason({ db: cdb, seasonId: FALL, uid: COACH });

  const page = await coachPage({ width: 1366, height: 768 });
  await management(page).getByRole("button", { name: "Season Update" }).click();
  await page.getByText("No draft seasons.").waitFor({ timeout: 20000 });
  assert.equal(await page.getByRole("button", { name: /^Delete draft/ }).count(), 0);

  for (const [id, why] of [[DRAFT, /draft/], [SPRING, /Finalized/], [FALL, /before drafts|current/]]) {
    await assert.rejects(deleteDraftSeason({ db: cdb, uid: COACH, seasonId: id }), why, id);
    await assert.rejects(deleteDoc(doc(cdb, "seasons", id)), /permission/i, id);
    assert.ok((await db.doc(`seasons/${id}`).get()).exists, id);
  }
  assert.equal(await config(), FALL);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
