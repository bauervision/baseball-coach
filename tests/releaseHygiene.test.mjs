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
  assert.match(read("next.config.ts"), /env:\s*\{\s*APP_VERSION:\s*packageJson\.version\s*,\s*BC_EMULATOR_BUILD:/);
  assert.equal((read("next.config.ts").match(/packageJson\./g) ?? []).length, 1, "only the version is read from package.json");
  assert.match(read("src/components/shell/Footer.tsx"), /process\.env\.APP_VERSION/);
});

test("emulator-only test seams are keyed to an always-defined build constant", () => {
  // next.config always defines BC_EMULATOR_BUILD ("0" unless tools/build-emulator.mjs),
  // so production code compiles these seams to dead code.
  assert.match(read("next.config.ts"), /BC_EMULATOR_BUILD: process\.env\.BC_EMULATOR_BUILD === "1" \? "1" : "0"/);
  for (const f of ["src/lib/features.ts", "src/lib/coachAccess.ts"]) {
    assert.match(read(f), /const EMULATOR_BUILD = process\.env\.BC_EMULATOR_BUILD === "1";/, f);
  }
});
