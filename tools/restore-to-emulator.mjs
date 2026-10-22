// Restores an export into the LOCAL EMULATOR ONLY, for recovery and
// migration rehearsals. There is no production override.
//
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 \
//     node tools/restore-to-emulator.mjs --project demo-baseball-coach \
//       --from-json <export.json> [--replace]
//
// Documents that were "missing" in the export (exists: false) are not
// created; only their subcollections are, exactly as in the source.
import crypto from "node:crypto";
import fs from "node:fs";
import { arg, connect, flag, fromJson } from "./identity/firestore.mjs";

const BATCH = 400;

try {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("Refusing to run: restore only targets the Firestore emulator.");
  const file = arg("--from-json");
  if (!file) throw new Error("Pass --from-json <export.json>.");

  const body = fs.readFileSync(file, "utf8");
  const shaFile = `${file}.sha256`;
  if (fs.existsSync(shaFile)) {
    const expected = fs.readFileSync(shaFile, "utf8").split(/\s+/)[0];
    const actual = crypto.createHash("sha256").update(body).digest("hex");
    if (expected !== actual) throw new Error("Export checksum mismatch; file changed since export.");
  }
  const snapshot = JSON.parse(body);
  if (!snapshot.raw) throw new Error("Export has no raw tree (made by an older exporter).");

  const { db, projectId } = connect({ productionFlag: "--never-allowed" });

  const existing = await db.listCollections();
  if (existing.length && !flag("--replace")) {
    throw new Error("Emulator database is not empty; pass --replace to clear it first.");
  }
  if (existing.length) {
    const res = await fetch(
      `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`Could not clear emulator: ${res.status}`);
  }

  const writes = [];
  const walk = (docs, colPath) => {
    for (const d of docs) {
      const docPath = `${colPath}/${d.id}`;
      if (d.exists) writes.push([docPath, d.data]);
      for (const [name, sub] of Object.entries(d.collections ?? {})) walk(sub, `${docPath}/${name}`);
    }
  };
  for (const [name, docs] of Object.entries(snapshot.raw)) walk(docs, name);

  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = db.batch();
    for (const [p, data] of writes.slice(i, i + BATCH)) batch.set(db.doc(p), fromJson(data, db));
    await batch.commit();
  }
  console.log(`Restored ${writes.length} documents from ${file} into emulator project ${projectId}.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}
