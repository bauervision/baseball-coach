import type { NextConfig } from "next";

import packageJson from "./package.json";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  turbopack: {
    root: __dirname,
  },

  // Only the version string reaches the client bundle, never package.json
  // (scripts, account names, dependencies).
  // BC_EMULATOR_BUILD is always defined ("1" only for tools/build-emulator.mjs),
  // so production code compiles emulator-only test seams to dead code.
  env: { APP_VERSION: packageJson.version, BC_EMULATOR_BUILD: process.env.BC_EMULATOR_BUILD === "1" ? "1" : "0" },

  // Emulator test builds export to their own folder (tools/build-emulator.mjs)
  // so browser tests can never be pointed at the production-configured out/.
  ...(process.env.BC_EMULATOR_BUILD === "1" ? { distDir: "out-emulator" } : {}),

  // Optional, but helps avoid surprises with static export.
  images: { unoptimized: true },
};

export default nextConfig;
