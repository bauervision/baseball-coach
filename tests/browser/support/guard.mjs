// Fail-closed production guard for browser automation.
//
// 1. Before Chromium starts: the target must be a local server serving an
//    emulator build — the bc-emulator-build.json stamp written by
//    tools/build-emulator.mjs — and every script it serves must name only
//    demo- Firebase projects (the app connects to emulators only for demo-
//    projects). A production-configured build (e.g. out/) is refused before
//    any navigation.
// 2. In the browser: every request to a non-local host is aborted and
//    recorded; assertNoExternalRequests() fails the run if any happened.

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export class ProductionGuardError extends Error {
  constructor(message) {
    super(`Browser test production guard: ${message}`);
    this.name = "ProductionGuardError";
  }
}

function isLocal(url) {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Throws unless baseUrl serves a stamped, demo-only emulator build. */
export async function assertEmulatorTarget(baseUrl) {
  if (!baseUrl) throw new ProductionGuardError("no BROWSER_BASE_URL.");
  if (!isLocal(baseUrl)) throw new ProductionGuardError(`${baseUrl} is not a local server.`);
  const base = baseUrl.replace(/\/+$/, "");

  const stampRes = await fetch(`${base}/bc-emulator-build.json`).catch(() => null);
  if (!stampRes?.ok) throw new ProductionGuardError("target is not an emulator build (missing bc-emulator-build.json; build with tools/build-emulator.mjs).");
  const stamp = await stampRes.json().catch(() => null);
  if (!stamp?.emulators || typeof stamp.projectId !== "string" || !stamp.projectId.startsWith("demo-")) {
    throw new ProductionGuardError("emulator build stamp is invalid.");
  }

  const html = await (await fetch(`${base}/`)).text();
  const scripts = [...new Set(html.match(/\/_next\/static\/[^"'\s]+\.js/g) ?? [])];
  if (scripts.length === 0) throw new ProductionGuardError("could not find the app's scripts to inspect.");
  const projectIds = new Set();
  for (const s of scripts) {
    const js = await (await fetch(`${base}${s}`)).text();
    for (const m of js.matchAll(/projectId:"([^"]*)"/g)) projectIds.add(m[1]);
    for (const m of js.matchAll(/authDomain:"([^"]*)"/g)) {
      if (!m[1].startsWith("demo-")) throw new ProductionGuardError(`authDomain ${m[1]} is not a demo- project.`);
    }
  }
  if (projectIds.size === 0) throw new ProductionGuardError("no Firebase project id found in the served app (ambiguous configuration).");
  const bad = [...projectIds].filter((id) => !id.startsWith("demo-"));
  if (bad.length) throw new ProductionGuardError(`served app is configured for ${bad.join(", ")} (not demo-).`);
  return { projectIds: [...projectIds], scripts: scripts.length };
}

/**
 * Launches Chromium only after assertEmulatorTarget passes, and blocks every
 * non-local request in each context. Use instead of chromium.launch().
 */
export async function launchGuardedBrowser(baseUrl, launchOptions = {}) {
  await assertEmulatorTarget(baseUrl);
  const { chromium } = await import("playwright");
  return guardBrowser(await chromium.launch(launchOptions));
}

/** Adds the network block to an already launched browser (used by tests of the guard). */
export function guardBrowser(browser) {
  const blocked = [];
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const ctx = await newContext(opts);
    await ctx.route("**/*", (route) => {
      const url = route.request().url();
      if (isLocal(url) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      blocked.push(url);
      return route.abort("blockedbyclient");
    });
    return ctx;
  };
  browser.blockedRequests = blocked;
  return browser;
}

/** Fails if any non-local request was attempted during the run. */
export function assertNoExternalRequests(browser) {
  const hosts = [...new Set((browser?.blockedRequests ?? []).map((u) => new URL(u).host))];
  if (hosts.length) throw new ProductionGuardError(`blocked requests to non-local hosts: ${hosts.join(", ")}`);
}
