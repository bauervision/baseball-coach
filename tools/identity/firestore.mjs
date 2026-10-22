// Shared Firestore access for the identity tools.
//
// Safety: defaults to the local emulator. Without FIRESTORE_EMULATOR_HOST
// the tools refuse to run unless an explicit production flag is passed, and
// the emulator must use a "demo-" project id so it can never reach a real
// project. Production access uses Application Default Credentials; nothing
// reads service-account.json.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase-admin/app";
import {
  DocumentReference,
  GeoPoint,
  getFirestore,
  Timestamp,
} from "firebase-admin/firestore";

export function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function flag(name) {
  return process.argv.includes(name);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Exports, audit reports, and rollback files contain children's names (legacy
 * roster ids embed them), so they must live outside the repository.
 */
export function assertOutsideRepo(target) {
  const rel = path.relative(REPO, path.resolve(target));
  // Across drives (Windows) relative() returns an absolute path: outside.
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(`Write ${target} outside the repository (it contains child data).`);
  }
}

export function connect({ productionFlag }) {
  const projectId = arg("--project");
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;

  if (!projectId) throw new Error("Pass --project <projectId>.");

  if (emulator) {
    if (!projectId.startsWith("demo-")) {
      throw new Error('Emulator runs must use a "demo-" project id.');
    }
  } else if (!flag(productionFlag)) {
    throw new Error(
      `FIRESTORE_EMULATOR_HOST is not set. Refusing to touch a real project without ${productionFlag}.`,
    );
  }

  // --database targets a named database (e.g. an isolated restore test
  // database). Default is the app's "(default)" database.
  const databaseId = arg("--database") ?? "(default)";
  const app = initializeApp({ projectId });
  const db = databaseId === "(default)" ? getFirestore(app) : getFirestore(app, databaseId);
  return { db, projectId, databaseId, emulator: !!emulator };
}

// ---------------------------------------------------------------------------
// Read-only snapshot
//
// The export is a complete backup, so it does not rely on the collections
// the app knows about: it walks every root collection and every
// subcollection (listCollections). It also uses listDocuments, which
// returns documents that no longer exist but still have subcollections. A
// season doc deleted or never written while its players/games survived
// shows up as `exists: false` instead of silently vanishing.

const KNOWN_SEASON_SUBCOLLECTIONS = new Set(["players", "games", "lineups"]);

async function dumpDoc(ref) {
  const snap = await ref.get();
  const collections = {};
  for (const col of await ref.listCollections()) {
    collections[col.id] = await dumpCollection(col);
  }
  return {
    id: ref.id,
    exists: snap.exists,
    data: snap.exists ? snap.data() : null,
    collections,
  };
}

async function dumpCollection(col) {
  const out = [];
  for (const ref of await col.listDocuments()) out.push(await dumpDoc(ref));
  return out;
}

const existing = (docs) =>
  (docs ?? []).filter((d) => d.exists).map((d) => ({ id: d.id, data: d.data }));

/**
 * Reads everything. Returns the raw tree (`raw`) plus a season-shaped view
 * (`seasons`) used by the audit and migration tools.
 */
export async function loadSnapshot(db) {
  const raw = {};
  for (const col of await db.listCollections()) {
    raw[col.id] = await dumpCollection(col);
  }

  const config = (raw.app ?? []).find((d) => d.id === "config");
  const seasons = (raw.seasons ?? []).map((s) => ({
    seasonId: s.id,
    data: s.data,
    parentMissing: !s.exists,
    players: existing(s.collections.players),
    games: (s.collections.games ?? []).map((g) => ({
      id: g.id,
      data: g.data,
      parentMissing: !g.exists,
      lines: existing(g.collections.lines),
    })),
    lineups: existing(s.collections.lineups),
    otherSubcollections: Object.keys(s.collections).filter(
      (name) => !KNOWN_SEASON_SUBCOLLECTIONS.has(name),
    ),
  }));

  return {
    exportedAt: new Date().toISOString(),
    config: config?.exists ? config.data : null,
    seasons,
    raw,
  };
}

function countTree(docs, path, counts) {
  for (const d of docs ?? []) {
    if (d.exists) counts[path] = (counts[path] ?? 0) + 1;
    for (const [name, sub] of Object.entries(d.collections ?? {})) {
      countTree(sub, `${path}/*/${name}`, counts);
    }
  }
  return counts;
}

/** Existing-document counts per collection path pattern, from a raw tree. */
export function treeCounts(raw) {
  const counts = {};
  for (const [name, docs] of Object.entries(raw ?? {})) countTree(docs, name, counts);
  return counts;
}

/**
 * Independently counts documents with server-side aggregation and compares
 * them with what the snapshot holds. Read-only.
 */
export async function verifyCounts(db, snapshot) {
  const exported = treeCounts(snapshot.raw);
  const checks = [];
  for (const name of Object.keys(snapshot.raw)) {
    const server = (await db.collection(name).count().get()).data().count;
    checks.push({ path: name, server, exported: exported[name] ?? 0 });
  }
  for (const group of ["players", "games", "lines", "lineups"]) {
    const server = (await db.collectionGroup(group).count().get()).data().count;
    const local = Object.entries(exported)
      .filter(([path]) => path.endsWith(`/${group}`))
      .reduce((n, [, c]) => n + c, 0);
    checks.push({ path: `**/${group}`, server, exported: local });
  }
  return { ok: checks.every((c) => c.server === c.exported), checks };
}

// ---------------------------------------------------------------------------
// JSON encoding that round-trips Firestore types

/** JSON-safe copy. Timestamps, references, geopoints, and bytes are tagged. */
export function toJson(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(toJson);
  if (value instanceof Timestamp) return { __timestamp: value.toDate().toISOString() };
  if (value instanceof Date) return { __timestamp: value.toISOString() };
  if (value instanceof DocumentReference) return { __ref: value.path };
  if (value instanceof GeoPoint) return { __geo: [value.latitude, value.longitude] };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __bytes: Buffer.from(value).toString("base64") };
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]));
}

/** Inverse of toJson, for restoring an export into the emulator. */
export function fromJson(value, db) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => fromJson(v, db));
  const keys = Object.keys(value);
  if (keys.length === 1) {
    if (keys[0] === "__timestamp") return Timestamp.fromDate(new Date(value.__timestamp));
    if (keys[0] === "__ref") return db.doc(value.__ref);
    if (keys[0] === "__geo") return new GeoPoint(value.__geo[0], value.__geo[1]);
    if (keys[0] === "__bytes") return Buffer.from(value.__bytes, "base64");
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromJson(v, db)]));
}
