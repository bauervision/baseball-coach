// Builds the app for emulator-backed browser tests into out-emulator/.
//
//   node tools/build-emulator.mjs            # registry feature on (as the tests expect)
//
// Every Firebase setting is forced to the demo- project and the local
// emulators, overriding .env.local (which holds the real production config).
// The result is stamped with out-emulator/bc-emulator-build.json; the browser
// test guard (tests/browser/support/guard.mjs) refuses any target without it.
// The normal production build (`npm run build` → out/) is never touched.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EMULATOR_PROJECT_ID = "demo-baseball-coach";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out-emulator");

export const EMULATOR_ENV = {
  BC_EMULATOR_BUILD: "1",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: EMULATOR_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${EMULATOR_PROJECT_ID}.appspot.com`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:demo",
  NEXT_PUBLIC_FIREBASE_EMULATORS: "1",
  NEXT_PUBLIC_FEATURE_PLAYER_REGISTRY: "1",
  NEXT_PUBLIC_ADMIN_EMAILS: "coach@example.test",
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!EMULATOR_ENV.NEXT_PUBLIC_FIREBASE_PROJECT_ID.startsWith("demo-")) throw new Error("not a demo- project");
  fs.rmSync(OUT, { recursive: true, force: true });
  const res = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], {
    cwd: ROOT,
    env: { ...process.env, ...EMULATOR_ENV },
    stdio: "inherit",
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
  if (!fs.existsSync(path.join(OUT, "index.html"))) {
    console.error("Expected the export in out-emulator/; refusing to stamp.");
    process.exit(1);
  }
  fs.writeFileSync(
    path.join(OUT, "bc-emulator-build.json"),
    JSON.stringify({ projectId: EMULATOR_PROJECT_ID, emulators: true, builtAt: new Date().toISOString() }, null, 2),
  );
  console.log(`Emulator build ready in ${OUT} (project ${EMULATOR_PROJECT_ID}).`);
}
