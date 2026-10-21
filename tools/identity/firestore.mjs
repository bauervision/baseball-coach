// Shared Firestore access for the identity tools.
//
// Safety: defaults to the local emulator. Without FIRESTORE_EMULATOR_HOST
// the tools refuse to run unless an explicit production flag is passed, and
// the emulator must use a "demo-" project id so it can never reach a real
// project. Production access uses Application Default Credentials; nothing
// reads service-account.json.

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function flag(name) {
  return process.argv.includes(name);
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

  initializeApp({ projectId });
  return { db: getFirestore(), projectId, emulator: !!emulator };
}

/** Reads app/config and the full season tree. Read-only. */
export async function loadSnapshot(db) {
  const configSnap = await db.doc("app/config").get();
  const seasonsSnap = await db.collection("seasons").get();
  const seasons = [];
  for (const s of seasonsSnap.docs) {
    const players = (await s.ref.collection("players").get()).docs.map((p) => ({
      id: p.id,
      data: p.data(),
    }));
    const games = [];
    for (const g of (await s.ref.collection("games").get()).docs) {
      const lines = (await g.ref.collection("lines").get()).docs.map((l) => ({
        id: l.id,
        data: l.data(),
      }));
      games.push({ id: g.id, data: g.data(), lines });
    }
    const lineups = (await s.ref.collection("lineups").get()).docs.map((l) => ({
      id: l.id,
      data: l.data(),
    }));
    seasons.push({ seasonId: s.id, data: s.data(), players, games, lineups });
  }
  return {
    exportedAt: new Date().toISOString(),
    config: configSnap.exists ? configSnap.data() : null,
    seasons,
  };
}

/** JSON-safe copy (Timestamps become ISO strings). */
export function toJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_k, v) =>
      v && typeof v === "object" && typeof v.toDate === "function"
        ? { __timestamp: v.toDate().toISOString() }
        : v,
    ),
  );
}
