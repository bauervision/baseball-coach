// Tallies migration tool (Checkpoint D1): legacy Baseball Coach data →
// Tallies team-scoped model. Run through npm so app modules resolve:
//
//   npm run tallies:migrate -- inspect  --from-json <export.json> --out <inventory.json>
//   npm run tallies:migrate -- plan     --from-json <export.json> --owner-uid <uid> --out <plan.json>
//                                       [--legacy-team <teamId>] [--accept-no-current]
//   npm run tallies:migrate -- apply    --project demo-… --plan <plan.json> --backup <export.json>
//   npm run tallies:migrate -- verify   --source <pre-export.json> (--project demo-… | --from-json <post-export.json>)
//                                       --out <report.json> [--owner-uid <uid>] [--legacy-team <teamId>]
//   npm run tallies:migrate -- rollback --project demo-… --rollback <rollback.json>
//
// inspect/plan/verify read a local export file (offline) or the emulator.
// apply and rollback write ONLY to the local Firestore emulator; there is no
// production path and no flag that enables one (tools/tallies-migration/
// emulator.mjs). Production exports are taken separately, under their own
// approval, with tools/export-firestore.mjs.
//
// Every file this tool writes holds child data, so it must be outside the
// repository and is never overwritten. Console output: counts, ids of
// seasons/teams, and finding codes only — never player names.
//
// Exit codes: 0 ok · 2 usage/environment refused · 3 plan has blockers ·
// 4 verification failed · 5 conflicts (nothing overwritten) · 6 interrupted.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertOutsideRepo } from "./identity/firestore.mjs";
import { inventory, inventorySummary } from "./tallies-migration/inventory.mjs";
import { buildPlan, stateFromRaw } from "./tallies-migration/model.mjs";
import { verificationSummary, verifyMigration } from "./tallies-migration/verify.mjs";
import {
  ConflictError,
  EnvironmentError,
  applyPlan,
  openEmulatorDatabase,
  readLiveState,
  rollbackFromBackup,
  rollbackPlan,
} from "./tallies-migration/emulator.mjs";

const COMMANDS = {
  inspect: { values: ["--from-json", "--project", "--out"], flags: [] },
  plan: { values: ["--from-json", "--project", "--out", "--owner-uid", "--legacy-team"], flags: ["--accept-no-current"] },
  apply: { values: ["--project", "--plan", "--backup", "--report", "--simulate-interruption-after"], flags: [] },
  verify: { values: ["--source", "--from-json", "--project", "--out", "--owner-uid", "--legacy-team"], flags: [] },
  rollback: { values: ["--project", "--rollback"], flags: [] },
};

class UsageError extends Error {}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const spec = COMMANDS[command];
  if (!spec) throw new UsageError(`Unknown command "${command ?? ""}". Use one of: ${Object.keys(COMMANDS).join(", ")}.`);
  const out = { command };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (spec.flags.includes(a)) out[a] = true;
    else if (spec.values.includes(a)) {
      if (rest[i + 1] === undefined || rest[i + 1].startsWith("--")) throw new UsageError(`${a} needs a value.`);
      out[a] = rest[++i];
    } else throw new UsageError(`Unknown option "${a}" for ${command}. (There is no production option.)`);
  }
  return out;
}

const redact = (p) =>
  String(p)
    .replace(/\/players\/[^/]+/g, "/players/<entry>")
    .replace(/^(admins|coaches|coachProfiles)\/[^/]+/, "$1/<uid>")
    .replace(/^coachWorkspaces\/[^/]+/, "coachWorkspaces/<workspace>");

function readExport(file) {
  const body = fs.readFileSync(file, "utf8");
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  const side = `${file}.sha256`;
  if (fs.existsSync(side) && fs.readFileSync(side, "utf8").split(/\s+/)[0] !== sha) throw new UsageError(`${file} does not match its .sha256 file.`);
  const snapshot = JSON.parse(body);
  if (!snapshot.raw) throw new UsageError(`${file} is not a full export (no raw tree); use tools/export-firestore.mjs.`);
  return { state: stateFromRaw(snapshot.raw), source: { projectId: snapshot.projectId ?? null, exportedAt: snapshot.exportedAt ?? null, sha256: sha }, snapshot };
}

function writeOut(file, value) {
  const abs = path.resolve(file);
  assertOutsideRepo(abs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(value, null, 2), { flag: "wx" });
  return abs;
}

async function loadSource(args) {
  if (args["--from-json"] && args["--project"]) throw new UsageError("Pass either --from-json or --project, not both.");
  if (args["--from-json"]) return { ...readExport(args["--from-json"]), close: async () => {} };
  if (!args["--project"]) throw new UsageError("Pass --from-json <export.json> or --project <demo-…> (emulator).");
  const conn = await openEmulatorDatabase(process.env, args["--project"]);
  const state = await readLiveState(conn.db);
  return { state, source: { projectId: args["--project"], exportedAt: null, sha256: null, live: "emulator" }, close: conn.close };
}

const need = (args, k) => {
  if (!args[k]) throw new UsageError(`Pass ${k}.`);
  return args[k];
};

async function inspect(args) {
  const out = need(args, "--out");
  const src = await loadSource(args);
  try {
    const inv = inventory(src.state, src.source);
    const file = writeOut(out, inv);
    for (const line of inventorySummary(inv)) console.log(line);
    console.log(`Inventory written: ${file}`);
  } finally {
    await src.close();
  }
}

async function plan(args) {
  const out = need(args, "--out");
  const src = await loadSource(args);
  try {
    const p = buildPlan(src.state, { ownerUid: args["--owner-uid"], legacyTeamId: args["--legacy-team"], acceptNoCurrent: !!args["--accept-no-current"] }, src.source);
    const file = writeOut(out, p);
    console.log(`Plan ${p.planHash.slice(0, 12)} · target ${p.targetDigest.slice(0, 12)} · ${p.ops.length} operation(s): ${JSON.stringify(p.summary)}`);
    console.log(`Legacy team: ${p.legacyTeamId ?? "none"}${p.adoptedTeam ? " (adopted)" : ""}; legacy seasons: ${p.legacySeasonIds.join(", ") || "none"}`);
    for (const s of p.seasons) console.log(`  ${s.seasonId}: team ${s.teamId}, ${s.status}, published ${s.published}${s.current ? ", CURRENT" : ""}; ${s.players} players, ${s.games} games, ${s.lineups} lineups`);
    if (p.idMap.length) console.log(`Re-keyed roster entries (identity-keyed ids → opaque): ${p.idMap.length}`);
    for (const w of p.warnings) console.log(`  warning ${w.code}: ${redact(w.path)}`);
    for (const b of p.blockers) console.log(`  BLOCKER ${b.code}: ${redact(b.path)} — ${b.detail}`);
    console.log(`Plan written: ${file}`);
    if (p.blockers.length) {
      console.error(`Plan is BLOCKED (${p.blockers.length}); nothing can be applied until resolved.`);
      process.exitCode = 3;
    }
  } finally {
    await src.close();
  }
}

async function apply(args) {
  const projectId = need(args, "--project");
  const planFile = need(args, "--plan");
  const backupFile = need(args, "--backup");
  const p = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const backup = readExport(backupFile);
  if (backup.snapshot.projectId !== projectId) throw new UsageError(`The backup is an export of ${backup.snapshot.projectId}, not of ${projectId}.`);
  if (backup.snapshot.verification?.ok !== true) throw new UsageError("The backup's count verification did not pass; export again.");
  const conn = await openEmulatorDatabase(process.env, projectId);
  try {
    // The rollback file is written before any change.
    const rb = rollbackFromBackup(backup.state, p.options, backup.source);
    const rbFile = path.join(path.dirname(path.resolve(backupFile)), `tallies-d1-${rb.targetDigest.slice(0, 12)}-${backup.source.sha256.slice(0, 8)}-rollback.json`);
    if (fs.existsSync(rbFile)) {
      const prev = JSON.parse(fs.readFileSync(rbFile, "utf8"));
      if (prev.planHash !== rb.planHash) throw new UsageError(`${rbFile} exists for another plan.`);
    } else writeOut(rbFile, rb);
    console.log(`Rollback file: ${rbFile}`);

    const stopAfter = args["--simulate-interruption-after"] ? Number(args["--simulate-interruption-after"]) : null;
    const result = await applyPlan(conn.db, p, backup.state, {
      afterChunk: (n) => {
        if (stopAfter !== null && n >= stopAfter) throw Object.assign(new Error(`Simulated interruption after ${n} chunk(s).`), { simulated: true });
      },
    });
    console.log(`Applied: ${JSON.stringify(result.counts)} in ${result.chunks} chunk(s).`);

    const report = verifyMigration(backup.state, await readLiveState(conn.db), { ownerUid: p.ownerUid, legacyTeamId: p.legacyTeamId });
    const reportFile = writeOut(args["--report"] ?? path.join(path.dirname(path.resolve(backupFile)), `tallies-d1-verify-${Date.now()}.json`), report);
    for (const line of verificationSummary(report)) console.log(line);
    console.log(`Verification report: ${reportFile}`);
    if (!report.ok) process.exitCode = 4;
  } catch (e) {
    if (e instanceof ConflictError) {
      console.error(`CONFLICT: ${e.message}`);
      for (const c of e.conflicts.slice(0, 20)) console.error(`  ${c.action} ${redact(c.path)} [${c.fields.join(", ")}]`);
      console.error("Nothing was overwritten. The ledger is marked blocked. Recovery: inspect the listed documents against the backup; either restore them to their backup values and re-run apply, or run rollback with the rollback file above.");
      process.exitCode = 5;
      return;
    }
    if (e?.simulated) {
      console.error(`${e.message} (${e.chunksDone}/${e.chunks}). Re-run plan and apply to resume, or roll back.`);
      process.exitCode = 6;
      return;
    }
    throw e;
  } finally {
    await conn.close();
  }
}

async function verify(args) {
  const out = need(args, "--out");
  const source = readExport(need(args, "--source"));
  const dest = await loadSource(args);
  try {
    const report = verifyMigration(source.state, dest.state, { ownerUid: args["--owner-uid"], legacyTeamId: args["--legacy-team"] });
    report.source = source.source;
    report.destination = dest.source;
    const file = writeOut(out, report);
    for (const line of verificationSummary(report)) console.log(redact(line));
    console.log(`Verification report: ${file}`);
    if (!report.ok) process.exitCode = 4;
  } finally {
    await dest.close();
  }
}

async function rollback(args) {
  const rb = JSON.parse(fs.readFileSync(need(args, "--rollback"), "utf8"));
  const conn = await openEmulatorDatabase(process.env, need(args, "--project"));
  try {
    const counts = await rollbackPlan(conn.db, rb);
    console.log(`Rolled back: ${JSON.stringify(counts)}`);
  } catch (e) {
    if (e instanceof ConflictError) {
      console.error(`ROLLBACK STOPPED: ${e.message}`);
      for (const c of e.conflicts.slice(0, 20)) console.error(`  ${c.action} ${redact(c.path)}`);
      console.error("These documents changed after the migration; restore them manually from the backup export.");
      process.exitCode = 5;
      return;
    }
    throw e;
  } finally {
    await conn.close();
  }
}

const RUN = { inspect, plan, apply, verify, rollback };

try {
  const args = parseArgs(process.argv.slice(2));
  await RUN[args.command](args);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = e instanceof UsageError || e instanceof EnvironmentError ? 2 : process.exitCode || 1;
}

