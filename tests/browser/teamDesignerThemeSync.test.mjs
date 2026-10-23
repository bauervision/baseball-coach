// Browser regression test: the Team Designer's Editing and Preview theme
// switches share one state. Either switch must update both switches, the
// nine color fields, the live preview, and the contrast status, without
// losing unsaved edits to either palette.
//
// Needs the demo emulators and an app build pointed at them:
//   npx firebase emulators:start --only firestore,auth --project demo-baseball-coach
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-baseball-coach NEXT_PUBLIC_FIREBASE_API_KEY=demo-key \
//     NEXT_PUBLIC_FIREBASE_EMULATORS=1 NEXT_PUBLIC_ADMIN_EMAILS=coach@example.test npx next build
//   (serve out/ on a local port), then:
//   BROWSER_BASE_URL=http://127.0.0.1:3105 npm run test:browser
// Skipped when BROWSER_BASE_URL is not set. Fixture data only.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.BROWSER_BASE_URL;
const PROJECT = "demo-baseball-coach";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

const DARK = { bgBase: "#07131f", foreground: "#e5e6e8", card: "#0f2233", stroke: "rgba(204, 204, 204, 0.11029380963341695)", muted: "#8b8fa0", primary: "#2563eb", secondary: "#14b8a6", accent: "#d352f4", accent2: "#6aea53" };
const LIGHT = { bgBase: "#f4fbff", foreground: "#0e1116", card: "#ffffff", stroke: "rgba(15, 18, 25, 0.14)", muted: "rgba(14, 17, 22, 0.62)", primary: "#1d4ed8", secondary: "#0f766e", accent: "#d352f4", accent2: "#6aea53" };
const KEYS = Object.keys(DARK);

let browser;
let page;

before(async () => {
  if (!BASE) return;
  process.env.FIRESTORE_EMULATOR_HOST = FS_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  await getAuth().createUser({ uid: "coach-mike", email: "coach@example.test", password: "fixture-pass-123" });
  const db = getFirestore();
  await db.doc("admins/coach-mike").set({ role: "coach" });
  await db.doc("app/config").set({ currentSeasonId: "tigers-fall-2026" });
  await db.doc("seasons/tigers-fall-2026").set({ teamName: "Tigers", seasonLabel: "Fall 2026", league: "Mustang", record: { wins: 0, losses: 0 } });
  await db.doc("teams/falcons-ab12").set({
    teamId: "falcons-ab12", teamName: "Falcons", shortName: "FAL", sport: "softball", division: "10U",
    logo: null, palettes: { dark: DARK, light: LIGHT }, awardCollection: "original",
    createdAt: new Date(), updatedAt: new Date(),
  });

  const { chromium } = await import("playwright");
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(() =>
    localStorage.setItem("baseball-coach:session", JSON.stringify({ role: "admin", email: "coach@example.test", uid: "coach-mike", name: "Coach" })),
  );
  page = await ctx.newPage();
  await page.goto(`${BASE}/admin`);
  const signed = page.getByText("Signed in and allowlisted.");
  const email = page.getByLabel("Email");
  await signed.or(email).first().waitFor({ timeout: 30000 });
  if (!(await signed.isVisible())) {
    await email.fill("coach@example.test");
    await page.getByLabel("Password").fill("fixture-pass-123");
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await signed.waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Team Designer" }).click();
  await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 20000 });
  await page.getByRole("tab", { name: "Appearance" }).click();
});

after(async () => {
  await browser?.close();
});

const tab = (group, name) =>
  page.getByRole("tablist", { name: group }).getByRole("tab", { name });

async function expectTheme(mode, palette) {
  const other = mode === "dark" ? "light" : "dark";
  const label = mode === "dark" ? "Dark" : "Light";
  for (const group of ["Editing theme", "Preview theme"]) {
    assert.equal(await tab(group, label).getAttribute("aria-selected"), "true", `${group} shows ${label}`);
  }
  // The editor shows exactly the selected palette's nine fields.
  assert.equal(await page.locator(`input[id^="color-${mode}-"]`).count(), 9);
  assert.equal(await page.locator(`input[id^="color-${other}-"]`).count(), 0);
  for (const k of KEYS) {
    assert.equal(await page.locator(`#color-${mode}-${k}`).inputValue(), palette[k], `${mode} ${k}`);
  }
  // The live preview renders the same palette.
  const preview = await page.getByTestId("branding-preview").evaluate((el) => ({
    primary: el.style.getPropertyValue("--primary").trim(),
    secondary: el.style.getPropertyValue("--secondary").trim(),
    bg: el.style.getPropertyValue("--bg-base").trim(),
  }));
  assert.deepEqual(preview, { primary: palette.primary, secondary: palette.secondary, bg: palette.bgBase });
  // Contrast status describes the selected theme.
  const status = await page.getByRole("status").filter({ hasText: /Contrast check|Low contrast/ }).innerText();
  assert.match(status, new RegExp(`\\(${mode}`), status);
}

test("either theme switch updates both switches, the editor, the preview, and contrast", { skip: !BASE && "set BROWSER_BASE_URL" }, async () => {
  await expectTheme("dark", DARK);

  // Unsaved dark edit.
  await page.locator("#color-dark-primary").fill("#dc2626");
  const darkEdited = { ...DARK, primary: "#dc2626" };
  await expectTheme("dark", darkEdited);

  // The Preview switch changes the editor too.
  await tab("Preview theme", "Light").click();
  await expectTheme("light", LIGHT);

  // Unsaved light edit.
  await page.locator("#color-light-secondary").fill("#0e7490");
  const lightEdited = { ...LIGHT, secondary: "#0e7490" };
  await expectTheme("light", lightEdited);

  // The Editing switch changes the preview too; the dark edit survived.
  await tab("Editing theme", "Dark").click();
  await expectTheme("dark", darkEdited);

  // And back via the Editing switch; the light edit survived.
  await tab("Editing theme", "Light").click();
  await expectTheme("light", lightEdited);

  // Back via the Preview switch.
  await tab("Preview theme", "Dark").click();
  await expectTheme("dark", darkEdited);
  assert.ok(await page.getByText("Unsaved changes", { exact: true }).first().isVisible());
});
