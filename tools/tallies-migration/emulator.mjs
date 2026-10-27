// Emulator-only execution for the Tallies migration (Checkpoint D1).
//
// PRODUCTION EXECUTION IS STRUCTURALLY BLOCKED: this module is the only
// place that opens a database, and it can only open the local Firestore
// emulator. There is no production branch, no override flag, and no
// credential loading. A future, separately approved release checkpoint must
// add a reviewed production connector here (with its own preflight); no
// command-line option can enable one.
//
// The environment is verified, never inferred from one variable: loopback
// emulator host, a "demo-" project id, no conflicting project or credential
// variables, and a live emulator answering on that host. Any doubt fails
// closed before a client is created.

import crypto from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";

import { fromJson, loadSnapshot, toJson } from "../identity/firestore.mjs";
import {
  LEDGER_PATH,
  MIGRATION_ID,
  buildPlan,
  chunkOps,
  classify,
  classifyRollback,
  desiredState,
  isAbsent,
  stateFromRaw,
  targetDigest,
} from "./model.mjs";

const PRODUCTION_PROJECT_IDS = new Set(["baseball-coach-997ab"]);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const CHUNK = 100;

export class EnvironmentError extends Error {}

/**
 * Pure environment check. Returns { host, port, projectId } or throws.
 * env: process.env-like object; projectId: from --project.
 */
export function assertEmulatorEnvironment(env, projectId) {
  const raw = env.FIRESTORE_EMULATOR_HOST;
  if (!raw) throw new EnvironmentError("FIRESTORE_EMULATOR_HOST is not set. This tool only runs against the local Firestore emulator.");
  const m = /^(\[::1\]|[^:]+):(\d{2,5})$/.exec(String(raw).trim());
  if (!m) throw new EnvironmentError(`FIRESTORE_EMULATOR_HOST "${raw}" is not host:port.`);
  const [, host, port] = m;
  if (!LOOPBACK.has(host.toLowerCase())) throw new EnvironmentError(`FIRESTORE_EMULATOR_HOST must be a loopback address, not ${host}.`);
  if (!projectId) throw new EnvironmentError("Pass --project <demo-…>.");
  if (!/^demo-[a-z0-9-]+$/.test(projectId)) throw new EnvironmentError(`Project "${projectId}" is not a demo- project; only emulator demo projects are allowed.`);
  if (PRODUCTION_PROJECT_IDS.has(projectId)) throw new EnvironmentError("The production project is never a target.");
  for (const k of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "FIREBASE_PROJECT"]) {
    if (env[k] && env[k] !== projectId) throw new EnvironmentError(`${k}=${env[k]} conflicts with --project ${projectId}.`);
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) throw new EnvironmentError("GOOGLE_APPLICATION_CREDENTIALS is set; unset it. The emulator needs no credentials.");
  if (env.FIREBASE_CONFIG && !String(env.FIREBASE_CONFIG).includes(projectId)) throw new EnvironmentError("FIREBASE_CONFIG names another project.");
  return { host: host === "[::1]" ? "[::1]" : host, port: Number(port), projectId };
}

/** The emulator answers "Ok" on its root; a real Firestore endpoint does not. */
export async function probeEmulator({ host, port }) {
  let res;
  try {
    res = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(3000) });
  } catch {
    throw new EnvironmentError(`No Firestore emulator answers at ${host}:${port}.`);
  }
  const body = (await res.text()).trim();
  if (!res.ok || body !== "Ok") throw new EnvironmentError(`${host}:${port} is not a Firestore emulator.`);
}

/** Opens the emulator database (and nothing else). */
export async function openEmulatorDatabase(env, projectId) {
  const target = assertEmulatorEnvironment(env, projectId);
  await probeEmulator(target);
  const app = initializeApp({ projectId: target.projectId }, `tallies-migration-${crypto.randomBytes(6).toString("hex")}`);
  const db = getFirestore(app);
  // Pin the connection to the verified emulator, whatever the environment
  // says later.
  db.settings({ host: `${target.host}:${target.port}`, ssl: false });
  return { db, app, target, close: () => deleteApp(app) };
}

export async function readLiveState(db) {
  return stateFromRaw(toJson(await loadSnapshot(db)).raw);
}

// ---------------------------------------------------------------------------
// Apply

const toWrite = (v, db) => (v && typeof v === "object" && v.__serverTimestamp === true ? FieldValue.serverTimestamp() : fromJson(v, db));

function writeOp(tx, db, op) {
  const ref = db.doc(op.path);
  if (op.action === "delete") return tx.delete(ref);
  if (op.action === "create") return tx.create(ref, Object.fromEntries(Object.entries(op.after).map(([k, v]) => [k, toWrite(v, db)])));
  const args = [];
  for (const [k, v] of Object.entries(op.after)) args.push(new FieldPath(k), isAbsent(v) ? FieldValue.delete() : toWrite(v, db));
  return tx.update(ref, args[0], args[1], ...args.slice(2));
}

function revertOp(tx, db, op) {
  const ref = db.doc(op.path);
  if (op.action === "create") return tx.delete(ref);
  if (op.action === "delete") return tx.create(ref, fromJson(op.before, db));
  const args = [];
  for (const [k, v] of Object.entries(op.before)) args.push(new FieldPath(k), isAbsent(v) ? FieldValue.delete() : fromJson(v, db));
  return tx.update(ref, args[0], args[1], ...args.slice(2));
}

export class ConflictError extends Error {
  constructor(conflicts) {
    super(`${conflicts.length} conflicting document(s); nothing in that chunk was written.`);
    this.conflicts = conflicts;
  }
}

/**
 * Applies a reviewed plan to the emulator. Every document is classified
 * inside a transaction just before it is written: already done → unchanged;
 * in the planned before-state → written; anything else → conflict (the
 * chunk is abandoned and the run stops; nothing is overwritten).
 *
 * backupState: the verified pre-migration export (as a state). Its desired
 * end state must equal the plan's, and so must the live database's.
 * hooks.afterChunk(n): test hook to simulate an interruption.
 */
export async function applyPlan(db, plan, backupState, hooks = {}) {
  if (plan.kind !== "tallies-migration-plan" || plan.migrationId !== MIGRATION_ID) throw new Error("Not a Tallies migration plan.");
  if (plan.blockers.length) throw new Error(`The plan has ${plan.blockers.length} blocker(s); resolve them and re-plan.`);
  const backupDesired = desiredState(backupState, plan.options).desired;
  if (targetDigest(backupDesired) !== plan.targetDigest) {
    throw new Error("The backup export is not the source this plan was made from (different end state). Export again and re-plan.");
  }
  const live = await readLiveState(db);
  const liveDesired = desiredState(live, plan.options);
  if (liveDesired.blockers.length) throw new Error(`The database now has blockers (${liveDesired.blockers.map((b) => b.code).join(", ")}); re-plan.`);
  if (targetDigest(liveDesired.desired) !== plan.targetDigest) {
    throw new Error("The database changed since this plan was made (different end state). Nothing was written; export, re-plan, and review again.");
  }

  const ledgerRef = db.doc(LEDGER_PATH);
  const ledger = (await ledgerRef.get()).data();
  if (ledger && ledger.state === "applying" && ledger.targetDigest !== plan.targetDigest) {
    throw new Error("Another migration plan is partially applied. Resume it with its own plan or roll it back first.");
  }
  if (ledger && ledger.state === "blocked" && ledger.targetDigest !== plan.targetDigest) {
    throw new Error("A previous run stopped on conflicts; resolve them (see the ledger) before applying another plan.");
  }
  await ledgerRef.set(
    {
      migrationId: MIGRATION_ID,
      state: "applying",
      targetDigest: plan.targetDigest,
      planHash: plan.planHash,
      ownerUid: plan.ownerUid,
      workspaceId: plan.workspaceId,
      legacyTeamId: plan.legacyTeamId,
      legacySeasonIds: plan.legacySeasonIds,
      adoptedTeam: plan.adoptedTeam,
      startedAt: FieldValue.serverTimestamp(),
      runs: FieldValue.arrayUnion({ planHash: plan.planHash, ops: plan.ops.length, at: new Date().toISOString() }),
    },
    { merge: true },
  );

  const counts = { created: 0, updated: 0, deleted: 0, unchanged: 0, conflict: 0 };
  const parts = chunkOps(plan.ops, CHUNK);
  let done = 0;
  for (const part of parts) {
    try {
      await db.runTransaction(async (tx) => {
        const snaps = await tx.getAll(...part.map((op) => db.doc(op.path)));
        const local = { created: 0, updated: 0, deleted: 0, unchanged: 0 };
        const conflicts = [];
        const todo = [];
        part.forEach((op, i) => {
          const have = snaps[i].exists ? toJson(snaps[i].data()) : undefined;
          const c = classify(op, have);
          if (c === "conflict") conflicts.push({ path: op.path, action: op.action, fields: Object.keys(op.after ?? op.before ?? {}) });
          else if (c === "unchanged") local.unchanged++;
          else todo.push(op);
        });
        if (conflicts.length) throw new ConflictError(conflicts);
        for (const op of todo) {
          writeOp(tx, db, op);
          local[op.action === "create" ? "created" : op.action === "delete" ? "deleted" : "updated"]++;
        }
        tx.set(ledgerRef, { progress: { chunksDone: done + 1, chunks: parts.length, lastSeq: part[part.length - 1].seq } }, { merge: true });
        part.local = local;
      });
    } catch (e) {
      if (e instanceof ConflictError) {
        counts.conflict += e.conflicts.length;
        await ledgerRef.set({ state: "blocked", conflicts: e.conflicts.slice(0, 100), blockedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      throw Object.assign(e, { counts, chunksDone: done, chunks: parts.length });
    }
    for (const [k, v] of Object.entries(part.local)) counts[k] += v;
    done++;
    await hooks.afterChunk?.(done, parts.length);
  }
  await ledgerRef.set({ state: "complete", completedAt: FieldValue.serverTimestamp(), counts, conflicts: FieldValue.delete() }, { merge: true });
  return { counts, chunks: parts.length };
}

/**
 * Undoes the migration on the emulator, op by op in reverse: a document
 * still in its migrated state is restored to its pre-migration fields; one
 * already in its original state is left alone; anything else is a conflict
 * that stops the rollback for manual review (never overwritten).
 */
export async function rollbackPlan(db, rollback) {
  if (rollback.kind !== "tallies-migration-rollback") throw new Error("Not a Tallies migration rollback file.");
  const ops = [...rollback.ops].reverse().map((op) => ({ ...op, phase: `r-${op.phase}` }));
  const counts = { restored: 0, unchanged: 0, conflict: 0 };
  for (const part of chunkOps(ops, CHUNK)) {
    await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...part.map((op) => db.doc(op.path)));
      const conflicts = [];
      const todo = [];
      part.forEach((op, i) => {
        const c = classifyRollback(op, snaps[i].exists ? toJson(snaps[i].data()) : undefined);
        if (c === "conflict") conflicts.push({ path: op.path, action: op.action });
        else if (c === "unchanged") counts.unchanged++;
        else todo.push(op);
      });
      if (conflicts.length) {
        counts.conflict += conflicts.length;
        throw new ConflictError(conflicts);
      }
      for (const op of todo) revertOp(tx, db, op);
      counts.restored += todo.length;
    });
  }
  await db.doc(LEDGER_PATH).set({ state: "rolled-back", rolledBackAt: FieldValue.serverTimestamp(), rollbackCounts: counts }, { merge: true });
  return counts;
}

/** Rollback content: the full pre-migration plan, recomputed from the backup. */
export function rollbackFromBackup(backupState, options, source) {
  const pristine = buildPlan(backupState, options, source);
  return {
    kind: "tallies-migration-rollback",
    migrationId: MIGRATION_ID,
    targetDigest: pristine.targetDigest,
    planHash: pristine.planHash,
    source,
    ops: pristine.ops,
  };
}
