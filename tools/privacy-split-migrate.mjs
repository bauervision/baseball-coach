// Public/private split for season documents. Dry-run by default.
//
//   # 1. plan (no writes): every document and field that would move
//   node tools/privacy-split-migrate.mjs --project <id>
//   # 2. apply (requires a fresh export as backup; writes a rollback file first)
//   node tools/privacy-split-migrate.mjs --project <id> --backup export.json --apply
//   # 3. undo
//   node tools/privacy-split-migrate.mjs --project <id> --rollback privacy-split-<ts>-rollback.json
//
// Moves private fields out of publicly readable documents (values unchanged):
//   seasons/{s}/players/{p}  →  seasons/{s}/players/{p}/private/profile
//     shirtSize, careerPlayerId, identityStatus, identityMigration, linkedFrom
//   seasons/{s}              →  seasons/{s}/private/audit
//     lifecycleHistory, finalizedByUid, reopenedByUid, coachUids
// and adds a public `careerLinks` list ({seasonId, seasonPlayerId}) to each
// roster entry: the other seasons the app's career view shows for it,
// never draft seasons (see careerLinksFor). Stats, games, lines, lineups, awards, layouts, and
// every other field are untouched and verified after apply. No identities
// are merged or created. Real projects additionally require
// --allow-production.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FieldValue } from "firebase-admin/firestore";
import { arg, assertOutsideRepo, connect, flag, loadSnapshot, toJson } from "./identity/firestore.mjs";
import { statsDigest } from "./identity/audit.mjs";

export const PLAYER_PRIVATE = ["shirtSize", "careerPlayerId", "identityStatus", "identityMigration", "linkedFrom"];
export const SEASON_PRIVATE = ["lifecycleHistory", "finalizedByUid", "reopenedByUid", "coachUids"];
const BATCH_OPS = 200; // each op is up to 2 writes

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const pick = (data, keys) => Object.fromEntries(keys.filter((k) => k in (data ?? {})).map((k) => [k, data[k]]));

/** Reads seasons, roster entries, and their private docs (if any). */
export async function readState(db) {
  const seasons = [];
  for (const s of (await db.collection("seasons").get()).docs) {
    const audit = await db.doc(`seasons/${s.id}/private/audit`).get();
    const players = [];
    for (const p of (await s.ref.collection("players").get()).docs) {
      const prof = await p.ref.collection("private").doc("profile").get();
      players.push({ id: p.id, data: p.data(), private: prof.exists ? prof.data() : null });
    }
    seasons.push({ id: s.id, data: s.data(), audit: audit.exists ? audit.data() : null, players });
  }
  return seasons;
}

/**
 * Career links per roster entry: exactly the other seasons the app's career
 * view shows for that entry (resolveCareerParticipations in
 * src/lib/careerHistory.ts — the subject's careerPlayerId, confirmed entries
 * with it, their one-level linkedFrom targets, one entry per season), minus
 * seasons parents cannot see (draft or being deleted). Computed from the
 * effective identity fields, public or already private.
 */
export function careerLinksFor(seasons) {
  const hidden = new Set(seasons.filter((s) => ["draft", "deleting"].includes(s.data?.status)).map((s) => s.id));
  const entries = [];
  for (const s of seasons) {
    for (const p of s.players) {
      const eff = { ...pick(p.private, PLAYER_PRIVATE), ...pick(p.data, PLAYER_PRIVATE) };
      const id = typeof eff.careerPlayerId === "string" && eff.careerPlayerId.trim() ? eff.careerPlayerId.trim() : undefined;
      entries.push({ key: `${s.id}/${p.id}`, seasonId: s.id, seasonPlayerId: p.id, careerPlayerId: id, confirmed: eff.identityStatus === "confirmed", linkedFrom: Array.isArray(eff.linkedFrom) ? eff.linkedFrom : [] });
    }
  }
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const refKey = (r) => `${r?.seasonId}/${r?.seasonPlayerId}`;
  const out = new Map();
  for (const subject of entries) {
    const id = subject.careerPlayerId;
    if (!id) {
      out.set(subject.key, []);
      continue;
    }
    // Candidates the app loads: same careerPlayerId anywhere, plus linkedFrom
    // targets of the subject and of those.
    const all = new Map([[subject.key, subject]]);
    for (const e of entries) if (e.careerPlayerId === id) all.set(e.key, e);
    for (const c of [...all.values()]) for (const r of c.linkedFrom) if (byKey.has(refKey(r))) all.set(refKey(r), byKey.get(refKey(r)));
    const confirmed = [...all.values()].filter((d) => d.careerPlayerId === id && d.confirmed);
    const included = new Map(confirmed.map((d) => [d.key, d]));
    for (const d of confirmed) {
      for (const r of d.linkedFrom) {
        const linked = all.get(refKey(r));
        if (linked && (linked.careerPlayerId === id || linked.careerPlayerId === undefined)) included.set(linked.key, linked);
      }
    }
    if (!included.has(subject.key)) {
      out.set(subject.key, []);
      continue;
    }
    const perSeason = new Map();
    for (const d of included.values()) {
      if (d.seasonId === subject.seasonId && d.key !== subject.key) continue;
      if (!perSeason.has(d.seasonId)) perSeason.set(d.seasonId, d);
    }
    out.set(
      subject.key,
      [...perSeason.values()]
        .filter((d) => d.key !== subject.key && !hidden.has(d.seasonId))
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((d) => ({ seasonId: d.seasonId, seasonPlayerId: d.seasonPlayerId })),
    );
  }
  return out;
}

/** Planned operations; empty when already migrated. */
export function planSplit(seasons) {
  const links = careerLinksFor(seasons);
  const ops = [];
  for (const s of seasons) {
    const moved = pick(s.data, SEASON_PRIVATE);
    if (Object.keys(moved).length) {
      ops.push({ kind: "season", path: `seasons/${s.id}`, privatePath: `seasons/${s.id}/private/audit`, moved, privateBefore: s.audit, careerLinksBefore: undefined, careerLinks: undefined });
    }
    for (const p of s.players) {
      const pm = pick(p.data, PLAYER_PRIVATE);
      const want = links.get(`${s.id}/${p.id}`);
      const linksChange = want.length ? !same(p.data.careerLinks, want) : "careerLinks" in p.data;
      if (Object.keys(pm).length || linksChange) {
        ops.push({ kind: "player", path: `seasons/${s.id}/players/${p.id}`, privatePath: `seasons/${s.id}/players/${p.id}/private/profile`, moved: pm, privateBefore: p.private, careerLinksBefore: p.data.careerLinks, careerLinks: want });
      }
    }
  }
  return ops;
}

function conflicts(ops) {
  const out = [];
  for (const op of ops) {
    for (const [k, v] of Object.entries(op.moved)) {
      if (op.privateBefore && k in op.privateBefore && !same(op.privateBefore[k], v)) out.push(`${op.privatePath}.${k} already holds a different value`);
    }
  }
  return out;
}

export async function applyOps(db, ops, migrationId) {
  for (let i = 0; i < ops.length; i += BATCH_OPS) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + BATCH_OPS)) {
      if (Object.keys(op.moved).length) {
        batch.set(db.doc(op.privatePath), { ...op.moved, privacySplit: migrationId }, { merge: true });
      }
      const pub = Object.fromEntries(Object.keys(op.moved).map((k) => [k, FieldValue.delete()]));
      if (op.kind === "player") pub.careerLinks = op.careerLinks.length ? op.careerLinks : FieldValue.delete();
      if (Object.keys(pub).length) batch.update(db.doc(op.path), pub);
    }
    await batch.commit();
  }
}

export async function rollbackOps(db, ops) {
  for (let i = 0; i < ops.length; i += BATCH_OPS) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + BATCH_OPS)) {
      const pub = { ...op.moved };
      if (op.kind === "player") pub.careerLinks = op.careerLinksBefore === undefined ? FieldValue.delete() : op.careerLinksBefore;
      batch.update(db.doc(op.path), pub);
      if (Object.keys(op.moved).length) {
        if (op.privateBefore) batch.set(db.doc(op.privatePath), op.privateBefore);
        else batch.delete(db.doc(op.privatePath));
      }
    }
    await batch.commit();
  }
}

/** Every op landed; nothing else in the database changed. */
export async function verify(db, before, ops) {
  const problems = [];
  const after = await readState(db);
  if (planSplit(after).length) problems.push("re-plan is not empty");
  const find = (state, p) => {
    const [, sid, , pid] = p.split("/");
    const s = state.find((x) => x.id === sid);
    return pid ? s?.players.find((x) => x.id === pid) : s;
  };
  for (const op of ops) {
    const a = find(after, op.path);
    const b = find(before, op.path);
    const priv = op.kind === "player" ? a?.private : a?.audit;
    for (const [k, v] of Object.entries(op.moved)) {
      if (k in (a?.data ?? {})) problems.push(`${op.path}.${k} still public`);
      if (!same(priv?.[k], v)) problems.push(`${op.privatePath}.${k} differs`);
    }
    const strip = (d) => Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => k !== "careerLinks" && !(k in op.moved)));
    if (!same(strip(a?.data), strip(b?.data))) problems.push(`${op.path}: other fields changed`);
  }
  return problems;
}

async function main() {
  const { db, projectId } = connect({ productionFlag: "--allow-production" });
  const rollbackFile = arg("--rollback");
  if (rollbackFile) {
    const { ops } = JSON.parse(fs.readFileSync(rollbackFile, "utf8"));
    await rollbackOps(db, ops);
    console.log(`Rolled back ${ops.length} documents from ${rollbackFile}.`);
    return;
  }

  const before = await readState(db);
  const ops = planSplit(before);
  const bad = conflicts(ops);
  if (bad.length) {
    console.error("Plan has conflicts; nothing written:\n  " + bad.join("\n  "));
    process.exit(3);
  }
  const players = ops.filter((o) => o.kind === "player").length;
  console.log(`Planned updates: ${ops.length} (${players} roster entries, ${ops.length - players} seasons)`);
  for (const op of ops) {
    const fields = Object.keys(op.moved);
    console.log(`  ${op.path}: move [${fields.join(", ") || "-"}] → ${op.privatePath.split("/").slice(-2).join("/")}${op.kind === "player" ? `; careerLinks ${op.careerLinks.length}` : ""}`);
  }
  if (!flag("--apply")) {
    console.log("Dry run only. Re-run with --backup <export.json> --apply to write.");
    return;
  }
  if (ops.length === 0) {
    console.log("Nothing to apply.");
    return;
  }
  const backupFile = arg("--backup");
  if (!backupFile || !fs.existsSync(backupFile)) throw new Error("--apply requires --backup <export.json> from tools/export-firestore.mjs.");
  const backup = JSON.parse(fs.readFileSync(backupFile, "utf8"));
  const ageHours = (Date.now() - Date.parse(backup.exportedAt)) / 3.6e6;
  if (backup.projectId !== projectId || !(ageHours < 24) || backup.verification?.ok !== true || !backup.raw) {
    throw new Error(`Backup must be a complete, verified export of ${projectId} from the last 24h.`);
  }

  const digestBefore = statsDigest(toJson(await loadSnapshot(db)));
  const migrationId = `privacy-split-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const rollbackPath = path.join(path.dirname(path.resolve(backupFile)), `${migrationId}-rollback.json`);
  assertOutsideRepo(rollbackPath);
  fs.writeFileSync(rollbackPath, JSON.stringify({ migrationId, projectId, ops }, null, 2));
  console.log(`Rollback file written: ${rollbackPath}`);

  await applyOps(db, ops, migrationId);
  const problems = await verify(db, before, ops);
  if (statsDigest(toJson(await loadSnapshot(db))) !== digestBefore) problems.push("stats/games digest changed");
  if (problems.length) {
    console.error(`VERIFY FAILED:\n  ${problems.slice(0, 20).join("\n  ")}\nRoll back with --rollback ${rollbackPath}`);
    process.exit(4);
  }
  console.log(`Applied ${ops.length} (${migrationId}). Verified: private fields moved exactly; stats, games, and all other fields unchanged.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  });
}
