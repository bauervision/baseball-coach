// Firestore emulator helpers. Run via `npm run test:emulator`, which starts
// the emulator with this repo's firestore.rules under the demo project.
import { initializeApp as initAdmin, getApps as adminApps } from "firebase-admin/app";
import { getFirestore as adminFirestore } from "firebase-admin/firestore";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  setLogLevel,
  terminate,
} from "firebase/firestore";

// Expected permission-denied writes would otherwise flood the output.
setLogLevel("silent");

export const PROJECT_ID = "demo-baseball-coach";
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is not set; run `npm run test:emulator`.");
}
const [host, port] = HOST.split(":");

if (adminApps().length === 0) initAdmin({ projectId: PROJECT_ID });
/** Rules-bypassing admin SDK, for seeding and inspection only. */
export const admin = adminFirestore();

export async function clearFirestore() {
  const res = await fetch(
    `http://${HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`clear failed: ${res.status}`);
}

const open = [];

/** Client SDK as a signed-in user (or anonymous when uid is null). */
export function clientDb(uid) {
  const app = initializeApp(
    { projectId: PROJECT_ID, apiKey: "demo-key" },
    `client-${uid ?? "anon"}-${open.length}`,
  );
  const db = initializeFirestore(app, {});
  connectFirestoreEmulator(
    db,
    host,
    Number(port),
    uid ? { mockUserToken: { sub: uid, user_id: uid } } : undefined,
  );
  open.push({ app, db });
  return db;
}

export async function closeClients() {
  while (open.length) {
    const { app, db } = open.pop();
    await terminate(db);
    await deleteApp(app);
  }
}

/** Seeds a snapshot (fixtures.mjs format) plus admin allowlist docs. */
export async function seed(snapshot, adminUids = []) {
  const batch = admin.batch();
  for (const uid of adminUids) batch.set(admin.doc(`admins/${uid}`), { role: "coach" });
  if (snapshot.config) batch.set(admin.doc("app/config"), snapshot.config);
  for (const s of snapshot.seasons) {
    const sref = admin.doc(`seasons/${s.seasonId}`);
    batch.set(sref, { ...s.data, createdAt: new Date("2026-03-01T00:00:00Z") });
    for (const p of s.players) batch.set(sref.collection("players").doc(p.id), p.data);
    for (const g of s.games ?? []) {
      const gref = sref.collection("games").doc(g.id);
      batch.set(gref, g.data);
      for (const l of g.lines ?? []) batch.set(gref.collection("lines").doc(l.id), l.data);
    }
    for (const l of s.lineups ?? []) batch.set(sref.collection("lineups").doc(l.id), l.data);
  }
  await batch.commit();
}

export async function getData(path) {
  const snap = await admin.doc(path).get();
  return snap.exists ? snap.data() : null;
}

export async function expectDenied(promise) {
  try {
    await promise;
  } catch (e) {
    if (String(e?.code ?? e?.message).includes("permission-denied")) return;
    throw e;
  }
  throw new Error("Expected permission-denied, but the operation succeeded.");
}
