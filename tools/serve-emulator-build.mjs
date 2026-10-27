// Serves out-emulator/ (from tools/build-emulator.mjs) on 127.0.0.1 for
// browser tests:  node tools/serve-emulator-build.mjs [port=3105]
// Refuses to start without the emulator build stamp, so the
// production-configured out/ can never be served to the test browser.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "out-emulator");
const port = Number(process.argv[2] ?? 3105);
const stamp = path.join(ROOT, "bc-emulator-build.json");
if (!fs.existsSync(stamp) || !JSON.parse(fs.readFileSync(stamp, "utf8")).projectId?.startsWith("demo-")) {
  console.error("out-emulator/ is missing or not a demo- emulator build; run `npm run build:emulator` first.");
  process.exit(1);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain", ".woff2": "font/woff2", ".ico": "image/x-icon" };

http
  .createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    // Same rewrite as firebase.tallies.json: every /teams/** path is the team shell.
    if (!fs.existsSync(file) && rel.startsWith("/teams/")) file = path.join(ROOT, "teams", "index.html");
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1", () => console.log(`Serving out-emulator/ at http://127.0.0.1:${port}/`));
