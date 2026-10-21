// Node module resolve hook so tests can import app TypeScript directly:
// maps "@/x" to src/x and resolves extensionless relative imports to .ts.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

export async function resolve(specifier, context, next) {
  let spec = specifier;
  if (spec.startsWith("@/")) {
    spec = pathToFileURL(path.join(SRC, spec.slice(2))).href;
  }
  const local =
    spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("file:");
  if (local && !/\.[mc]?[jt]sx?$/.test(spec)) {
    for (const ext of [".ts", "/index.ts"]) {
      const candidate = new URL(spec + ext, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return next(candidate.href, context);
      }
    }
  }
  return next(spec, context);
}
