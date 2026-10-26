// The browser-test production guard refuses production-configured targets
// before any navigation, and blocks non-local requests in the browser.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { assertEmulatorTarget, assertNoExternalRequests, guardBrowser, launchGuardedBrowser } from "./browser/support/guard.mjs";

const servers = [];
after(() => servers.forEach((s) => s.close()));

function serve(dir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(dir, rel);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!file.startsWith(dir) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html" : "text/plain" }).end(fs.readFileSync(file));
  });
  servers.push(server);
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`)));
}

function fakeBuild({ projectId, stamp }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-"));
  fs.mkdirSync(path.join(dir, "_next", "static", "chunks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), '<script src="/_next/static/chunks/app.js"></script>');
  fs.writeFileSync(path.join(dir, "_next", "static", "chunks", "app.js"), `const c={apiKey:"k",authDomain:"${projectId}.firebaseapp.com",projectId:"${projectId}"};`);
  if (stamp) fs.writeFileSync(path.join(dir, "bc-emulator-build.json"), JSON.stringify(stamp));
  return dir;
}

test("refuses non-local and missing targets without contacting them", async () => {
  await assert.rejects(assertEmulatorTarget("https://bauer-baseball.web.app"), /not a local server/);
  await assert.rejects(assertEmulatorTarget(""), /no BROWSER_BASE_URL/);
});

test("refuses the production-configured out/ build before launching a browser", { skip: !fs.existsSync("out/index.html") && "no out/ build" }, async () => {
  const base = await serve(path.resolve("out"));
  await assert.rejects(launchGuardedBrowser(base), /not an emulator build/);
});

test("refuses a forged stamp around a production-configured app", async () => {
  const base = await serve(fakeBuild({ projectId: "baseball-coach-997ab", stamp: { projectId: "demo-x", emulators: true } }));
  await assert.rejects(assertEmulatorTarget(base), /configured for baseball-coach-997ab|authDomain/);
  const noIds = await serve(fakeBuild({ projectId: "", stamp: { projectId: "demo-x", emulators: true } }));
  await assert.rejects(assertEmulatorTarget(noIds), /not a demo- project|no Firebase project id/);
  const badStamp = await serve(fakeBuild({ projectId: "demo-x", stamp: { projectId: "baseball-coach-997ab", emulators: true } }));
  await assert.rejects(assertEmulatorTarget(badStamp), /stamp is invalid/);
});

test("accepts a demo-only stamped build", async () => {
  const base = await serve(fakeBuild({ projectId: "demo-baseball-coach", stamp: { projectId: "demo-baseball-coach", emulators: true } }));
  assert.deepEqual((await assertEmulatorTarget(base)).projectIds, ["demo-baseball-coach"]);
});

test("the real emulator build passes", { skip: !fs.existsSync("out-emulator/bc-emulator-build.json") && "no out-emulator build" }, async () => {
  const base = await serve(path.resolve("out-emulator"));
  assert.deepEqual((await assertEmulatorTarget(base)).projectIds, ["demo-baseball-coach"]);
});

test("in the browser, non-local requests are blocked and fail the run", async () => {
  const dir = fakeBuild({ projectId: "demo-x", stamp: { projectId: "demo-x", emulators: true } });
  fs.writeFileSync(path.join(dir, "probe.html"), "<p>probe</p>");
  const base = await serve(dir);
  const { chromium } = await import("playwright");
  const browser = guardBrowser(await chromium.launch());
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${base}/probe.html`);
    const result = await page.evaluate(() =>
      fetch("https://firestore.googleapis.com/v1/projects/baseball-coach-997ab/databases/(default)/documents/app/config").then(() => "reached", () => "blocked"),
    );
    assert.equal(result, "blocked");
    await assert.rejects(page.goto("https://bauer-baseball.web.app/"));
    assert.throws(() => assertNoExternalRequests(browser), /firestore\.googleapis\.com/);
  } finally {
    await browser.close();
  }
});
