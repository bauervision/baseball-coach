// Browser acceptance for New Season Setup (Team → Season → Roster → Ready).
//
// Needs the demo emulators and an app build pointed at them WITH the player
// registry enabled (linked children):
//   npx firebase emulators:start --only firestore,auth --project demo-baseball-coach
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-baseball-coach NEXT_PUBLIC_FIREBASE_API_KEY=demo-key \
//     NEXT_PUBLIC_FIREBASE_EMULATORS=1 NEXT_PUBLIC_FEATURE_PLAYER_REGISTRY=1 \
//     NEXT_PUBLIC_ADMIN_EMAILS=coach@example.test npx next build
//   (serve out/ locally), then BROWSER_BASE_URL=http://127.0.0.1:3105 npm run test:browser
// Skipped when BROWSER_BASE_URL is not set. Fixture data only.
//
// Order matters: B (Tigers, stays draft) → C (interrupted, mobile) →
// A (Falcons, activated) → D (historical Tigers unchanged).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { IDS, legacySnapshot } from "../support/fixtures.mjs";

const BASE = process.env.BROWSER_BASE_URL;
const SKIP = !BASE && "set BROWSER_BASE_URL";
const PROJECT = "demo-baseball-coach";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const COACH = "coach-mike";

let browser;
let db;
let historyBefore;

async function historyFingerprint() {
  const out = [];
  for (const id of ["tigers-2026", "tigers-fall-2026"]) {
    const ref = db.doc(`seasons/${id}`);
    out.push(JSON.stringify((await ref.get()).data()));
    for (const sub of ["players", "games", "lineups"]) {
      const q = await ref.collection(sub).get();
      for (const d of q.docs.sort((a, b) => a.id.localeCompare(b.id))) {
        out.push(`${sub}/${d.id}:${JSON.stringify(d.data())}`);
        if (sub === "games") {
          const lines = await d.ref.collection("lines").get();
          for (const l of lines.docs.sort((a, b) => a.id.localeCompare(b.id))) out.push(`line/${l.id}:${JSON.stringify(l.data())}`);
        }
      }
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
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  await getAuth().createUser({ uid: COACH, email: "coach@example.test", password: "fixture-pass-123" });

  const { LEGACY_TIGERS_BRANDING } = await import("../../src/lib/branding.ts");
  const snap = legacySnapshot();
  const batch = db.batch();
  batch.set(db.doc(`admins/${COACH}`), { role: "coach" });
  batch.set(db.doc("app/config"), snap.config);
  for (const s of snap.seasons) {
    const sref = db.doc(`seasons/${s.seasonId}`);
    batch.set(sref, { ...s.data, league: "Mustang" });
    for (const p of s.players) batch.set(sref.collection("players").doc(p.id), p.data);
    for (const g of s.games) {
      const gref = sref.collection("games").doc(g.id);
      batch.set(gref, g.data);
      for (const l of g.lines) batch.set(gref.collection("lines").doc(l.id), l.data);
    }
  }
  // The coach already made a Tigers team (original look) in Team Designer.
  batch.set(db.doc("teams/tigers-0001"), {
    ...structuredClone(LEGACY_TIGERS_BRANDING),
    teamId: "tigers-0001",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // Coach-linked child (My Players): Cole.
  batch.set(db.doc(`playerIdentities/${IDS.cole}`), { careerPlayerId: IDS.cole, displayName: "Cole Evans", managerUids: [COACH], createdByUid: COACH, createdAt: new Date(), updatedAt: new Date() });
  batch.set(db.doc(`coachProfiles/${COACH}/linkedPlayers/${IDS.cole}`), { careerPlayerId: IDS.cole, displayName: "Cole Evans", relationship: "child", confirmed: true, linkedAt: new Date() });
  await batch.commit();
  historyBefore = await historyFingerprint();

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
  await page.getByRole("navigation", { name: "Setup progress" }).waitFor();
}

const currentStep = (page) =>
  page.getByRole("navigation", { name: "Setup progress" }).locator('[aria-current="step"]').innerText();

async function noOverflow(page, label) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `${label}: horizontal overflow ${sw} > ${cw}`);
}

async function chooseSeason(page, term, year) {
  await page.getByRole("combobox", { name: "Season term" }).selectOption(term);
  await page.getByRole("textbox", { name: "Season year" }).fill(String(year));
}

async function importReturning(page, name) {
  const search = page.getByRole("searchbox", { name: "Search players you have coached" });
  await search.fill(name.split(" ")[0].toLowerCase());
  await page.getByRole("list", { name: "Returning player results" }).locator("label", { hasText: name }).first().click();
  await search.fill("");
}

const seasonDoc = async (id) => (await db.doc(`seasons/${id}`).get()).data();
const config = async () => (await db.doc("app/config").get()).data().currentSeasonId;

test("B: existing Tigers team → draft Spring 2027, linked child deselected, Fall 2026 stays current (1440)", { skip: SKIP }, async () => {
  const page = await coachPage({ width: 1440, height: 900 });
  await startSetup(page);
  assert.match(await currentStep(page), /Team/);
  await page.getByRole("button", { name: /^Tigers/ }).click();
  await page.waitForURL(/team=tigers-0001/);
  await page.getByRole("button", { name: "Next: Season" }).click();
  await page.waitForURL(/step=season/);
  await chooseSeason(page, "Spring", 2027);
  await page.getByText(/Creates Spring 2027 for Tigers as a draft/).waitFor();
  await page.getByRole("button", { name: "Create draft season" }).click();
  await page.waitForURL(/step=roster&team=tigers-0001&setupSeason=tigers-spring-2027/);

  // Linked child preselected, then deselected (not forced).
  await page.getByText(/Selected \(1\)/).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Deselect Cole Evans" }).click();
  await importReturning(page, "Ava Carter");
  await page.getByRole("button", { name: /^Add 1 to Spring 2027/ }).click();
  await page.getByText(/Added 1 player to tigers-spring-2027/).waitFor({ timeout: 20000 });
  await page.getByText(/1 player\b/).first().waitFor();
  await noOverflow(page, "1440 roster");
  await page.getByRole("button", { name: "Next: Ready" }).click();
  await page.waitForURL(/step=ready/);
  await page.getByText("Ready", { exact: true }).first().waitFor();
  assert.match(await page.getByRole("list", { name: "Readiness" }).innerText(), /Roster\s+1 player/);

  const s = await seasonDoc("tigers-spring-2027");
  assert.equal(s.status, "draft");
  assert.deepEqual(s.branding.palettes.dark.primary, "#ff4d00", "Tigers snapshot");
  assert.equal(await config(), "tigers-fall-2026", "current season unchanged");
  const players = await db.collection("seasons/tigers-spring-2027/players").get();
  assert.deepEqual(players.docs.map((d) => d.id), [IDS.ava], "deselected child not enrolled");
  assert.ok((await db.doc(`coachProfiles/${COACH}/linkedPlayers/${IDS.cole}`).get()).exists, "child still linked");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test("C: interrupted setup (mobile): leave after the draft, return, resume — no duplicates", { skip: SKIP }, async () => {
  const page = await coachPage({ width: 390, height: 844 }, true);
  await startSetup(page);
  await page.getByRole("radio", { name: "Create a new team" }).check();
  await page.getByLabel("Team name").fill("Hawks");
  await page.getByLabel("Division / age group").fill("12U");
  // Double submit must still make one team. (On mobile a sticky Save bar
  // repeats the button while there are unsaved edits.)
  await page.getByRole("button", { name: "Create team" }).first().dblclick();
  await page.waitForURL(/step=season&team=hawks-/);
  await noOverflow(page, "mobile season");
  await chooseSeason(page, "Spring", 2027);
  await page.getByRole("button", { name: "Create draft season" }).dblclick();
  await page.waitForURL(/step=roster/);
  const teamId = new URL(page.url()).searchParams.get("team");
  await noOverflow(page, "mobile roster");

  // Refresh keeps the step.
  await page.reload();
  await page.getByRole("navigation", { name: "Setup progress" }).waitFor({ timeout: 30000 });
  assert.match(await currentStep(page), /Roster/, "no flash of step 1 while loading");
  await page.getByRole("searchbox", { name: "Search players you have coached" }).waitFor({ timeout: 30000 });
  assert.match(await currentStep(page), /Roster/, "still Roster once loaded");

  // Leave setup, come back later, pick the team again. The preselected
  // linked child is an unsaved selection, so leaving asks first.
  let prompt = "";
  page.once("dialog", (d) => {
    prompt = d.message();
    d.accept();
  });
  await page.getByRole("button", { name: "Exit setup" }).click();
  await page.waitForURL((u) => !u.search.includes("setup="));
  assert.match(prompt, /Unsaved changes will be lost/, "unsaved selection protected");
  await page.getByRole("button", { name: "Start setup" }).waitFor();
  await startSetup(page);
  await page.getByRole("button", { name: /^Hawks/ }).click();
  await page.getByRole("button", { name: "Next: Season" }).click();
  await chooseSeason(page, "Spring", 2027);
  await page.getByText(/is already a draft for Hawks/).waitFor();
  await page.getByRole("button", { name: "Resume Spring 2027" }).first().click();
  await page.waitForURL(/step=roster&.*setupSeason=hawks-spring-2027/);

  const teams = await db.collection("teams").where("teamName", "==", "Hawks").get();
  assert.equal(teams.size, 1, "one Hawks team");
  const hawkSeasons = await db.collection("seasons").where("teamId", "==", teamId).get();
  assert.equal(hawkSeasons.size, 1, "one Hawks season");
  assert.equal(hawkSeasons.docs[0].data().status, "draft");
  assert.equal(await config(), "tigers-fall-2026");
  await noOverflow(page, "mobile resumed");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test("A: new Falcons softball team → Spring 2027 → roster → Ready → explicit activation → lineup (1366)", { skip: SKIP }, async () => {
  const page = await coachPage({ width: 1366, height: 768 });
  await startSetup(page);
  await page.getByRole("radio", { name: "Create a new team" }).check();
  await page.getByLabel("Team name").fill("Falcons");
  await page.getByLabel("Short name").fill("FAL");
  await page.getByLabel("Division / age group").fill("10U");
  await page.getByRole("button", { name: /^Softball/ }).click();
  await page.getByRole("button", { name: /^No logo/ }).click();
  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.locator("#color-dark-primary").fill("#2563eb");
  await page.locator("#color-dark-secondary").fill("#14b8a6");
  await page.getByRole("tablist", { name: "Editing theme" }).getByRole("tab", { name: "Light" }).click();
  await page.locator("#color-light-primary").fill("#1d4ed8");
  await noOverflow(page, "1366 team");
  await page.getByRole("button", { name: "Create team" }).click();
  await page.waitForURL(/step=season&team=falcons-/);

  await chooseSeason(page, "Spring", 2027);
  await page.getByRole("button", { name: "Create draft season" }).click();
  await page.waitForURL(/step=roster/);
  const s0 = await seasonDoc("falcons-spring-2027");
  assert.equal(s0.status, "draft");
  assert.equal(s0.branding.palettes.dark.primary, "#2563eb");
  assert.equal(s0.branding.palettes.light.primary, "#1d4ed8");
  assert.equal(s0.branding.sport, "softball");

  // Linked child included automatically; returning + new players.
  await page.getByText(/Selected \(1\)/).waitFor({ timeout: 20000 });
  await importReturning(page, "Ava Carter");
  await page.getByRole("button", { name: "Add new player" }).click();
  await page.getByLabel("Name").last().fill("Kai New");
  await page.getByRole("button", { name: /^Add 3 to Spring 2027/ }).click();
  await page.getByText(/Added 3 players to falcons-spring-2027/).waitFor({ timeout: 20000 });
  await page.getByText(/3 players/).first().waitFor();
  await page.getByText(/2 returning/).first().waitFor();
  await page.getByRole("button", { name: "Next: Ready" }).click();
  await page.waitForURL(/step=ready/);
  const summary = await page.locator("dl").first().innerText();
  assert.match(summary, /Falcons · Softball/);
  assert.match(summary, /10U/);
  assert.match(summary, /Spring 2027/);
  assert.match(summary, /3 players · 2 returning/);
  assert.match(summary, /Ready\s·\sDraft/);
  await noOverflow(page, "1366 ready");

  // Refresh + back/forward.
  await page.reload();
  await page.getByRole("list", { name: "Readiness" }).waitFor({ timeout: 30000 });
  await page.goBack();
  await page.waitForURL(/step=roster/);
  await page.goForward();
  await page.waitForURL(/step=ready/);
  await page.getByRole("list", { name: "Readiness" }).waitFor({ timeout: 30000 });

  // Ready ≠ Active: preparing the first game asks for explicit activation.
  assert.equal(await config(), "tigers-fall-2026");
  await page.getByRole("button", { name: "Prepare first game" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Lineups and game entry use the current season/);
  assert.equal(await config(), "tigers-fall-2026", "nothing activated by navigation");
  await page.getByRole("button", { name: "Make current and open lineup" }).click();
  await page.getByText("Lineup Builder").first().waitFor({ timeout: 20000 });
  assert.ok(!page.url().includes("setup="), "left setup");
  assert.equal(await config(), "falcons-spring-2027");
  assert.equal((await seasonDoc("falcons-spring-2027")).status, "active");
  const ava = (await db.doc(`seasons/falcons-spring-2027/players/${IDS.ava}`).get()).data();
  assert.equal(ava.careerPlayerId, IDS.ava);
  assert.ok(Object.values(ava.stats).every((v) => v === 0));
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test("D: historical Tigers seasons unchanged; their sheets still print in Tigers branding", { skip: SKIP }, async () => {
  assert.equal(await historyFingerprint(), historyBefore, "Spring/Fall 2026 data byte-identical");
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  await ctx.addInitScript(() => localStorage.setItem("baseball-coach:session", JSON.stringify({ role: "public", name: "Parent" })));
  const page = await ctx.newPage();
  for (const season of ["tigers-2026", "tigers-fall-2026"]) {
    await page.goto(`${BASE}/player/?id=07-ava-carter&season=${season}`);
    await page.locator("[data-player-plaque]").waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--primary").trim() === "#ff4d00", null, { timeout: 15000 });
    const brand = await page.locator(".recognition-sheet").first().evaluate((el) => el.style.getPropertyValue("--plq-brand").trim());
    assert.equal(brand, "#ff4d00", `${season} sheet keeps Tigers accents`);
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    const box = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\]/);
    assert.equal(pages, 1, `${season}: one page`);
    assert.deepEqual([box?.[1], box?.[2]], ["720", "576"], `${season}: 8x10`);
    await page.emulateMedia({ media: "screen" });
  }
  await ctx.close();
});
