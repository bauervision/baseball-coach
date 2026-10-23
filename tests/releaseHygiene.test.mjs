// Release hygiene guards (source-level).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

test("deployed builds keep forced long polling; only emulator builds auto-detect", () => {
  // The emulator's WebChannel forwarder intermittently drops long-poll
  // requests on Windows (BindException), leaving reads pending forever.
  const src = read("src/lib/firebase.client.ts");
  assert.match(src, /experimentalForceLongPolling:\s*!emulators/);
  assert.match(src, /projectId\.startsWith\("demo-"\)/, "emulators only with a demo- project");
});

test("the client bundle gets the version string only, never package.json", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /package\.json/.test(read(p))) offenders.push(p);
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
  assert.match(read("next.config.ts"), /env:\s*\{\s*APP_VERSION:\s*packageJson\.version\s*\}/);
  assert.match(read("src/components/shell/Footer.tsx"), /process\.env\.APP_VERSION/);
});
