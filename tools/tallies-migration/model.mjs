// Tallies migration model (Checkpoint D1). Pure functions only: no Firestore
// access, no clock, no randomness. Everything works on a flat "state": a Map
// from document path to JSON-tagged data (tools/identity/firestore.mjs
// toJson), built from an export file or an emulator snapshot.
//
// The migration is in place: season, game, line, and lineup ids are kept.
// It adds what the Tallies model needs and moves what must be private:
//   teams/{legacy}            created for the legacy (teamless) seasons
//   teams/{t}                 ownerUid, workspaceId (immutable owner)
//   publicTeams/{t}           parents' projection (published current only)
//   seasons/{s}               teamId (legacy), ownerUid, published;
//                             lifecycle audit fields → private/audit
//   seasons/{s}/players/{p}   private fields → private/profile; careerLinks;
//                             entries keyed by a permanent identity id are
//                             re-keyed to the app's opaque sp_ id
// Games, lines, lineups, stats, awards, layouts, status, branding snapshots,
// app/config, and admins are never changed.
//
// desiredState() is idempotent: applied to its own result it changes
// nothing, so a re-plan after (part of) an apply lists only what is left.

import crypto from "node:crypto";

import { LEGACY_TIGERS_BRANDING, validateBranding } from "../../src/lib/branding.ts";
import { computeCareerLinks, normalizeCareerLinks } from "../../src/lib/careerLinks.ts";
import { normalizeLinkedFrom } from "../../src/lib/careerHistory.ts";

export const MIGRATION_ID = "tallies-d1";
export const LEDGER_PATH = `migrationRuns/${MIGRATION_ID}`;
export const PLAN_VERSION = 1;

export const PLAYER_PRIVATE = ["shirtSize", "careerPlayerId", "identityStatus", "identityMigration", "linkedFrom"];
export const SEASON_PRIVATE = ["lifecycleHistory", "finalizedByUid", "reopenedByUid", "coachUids"];
export const TEAM_KEYS = [
  "teamId", "teamName", "shortName", "sport", "division", "logo", "palettes", "awardCollection",
  "ownerUid", "workspaceId", "currentSeasonId", "createdAt", "updatedAt",
];
export const PUBLIC_TEAM_KEYS = [
  "teamName", "shortName", "sport", "division", "logo", "palettes", "awardCollection", "currentSeasonId", "updatedAt",
];
const BRANDING_FIELDS = ["teamName", "shortName", "sport", "division", "logo", "palettes", "awardCollection"];
const STATUSES = ["draft", "active", "finalized", "deleting"];
const KNOWN_ROOTS = new Set([
  "seasons", "teams", "publicTeams", "app", "admins", "coaches", "coachWorkspaces", "coachInvites",
  "playerIdentities", "coachProfiles", "migrationRuns",
]);

/** Server timestamp placeholder in a planned value (written at apply time). */
export const SERVER_TS = Object.freeze({ __serverTimestamp: true });
/** A field that is (or must become) absent. */
export const ABSENT = Object.freeze({ __absent: true });

const isServerTs = (v) => !!v && typeof v === "object" && v.__serverTimestamp === true && Object.keys(v).length === 1;
export const isAbsent = (v) => !!v && typeof v === "object" && v.__absent === true && Object.keys(v).length === 1;
const isTimestamp = (v) => !!v && typeof v === "object" && typeof v.__timestamp === "string" && Object.keys(v).length === 1;

// ---------------------------------------------------------------------------
// Canonical JSON and hashing

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Equal values; a planned server timestamp matches any stored timestamp. */
export function sameValue(actual, wanted) {
  if (isServerTs(wanted)) return isTimestamp(actual) || isServerTs(actual);
  if (isAbsent(wanted) || actual === undefined) return (isAbsent(wanted) || wanted === undefined) && (actual === undefined || isAbsent(actual));
  return canonical(actual) === canonical(wanted);
}

/** Every planned field of `wanted` matches, and `actual` has no other fields. */
export function sameDoc(actual, wanted) {
  if (!actual || !wanted) return !actual && !wanted;
  const keys = new Set([...Object.keys(actual), ...Object.keys(wanted)]);
  for (const k of keys) if (!sameValue(actual[k], k in wanted ? wanted[k] : ABSENT)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// State

/** Flattens an export's raw tree into a state Map (existing docs only). */
export function stateFromRaw(raw) {
  const state = new Map();
  const missingParents = [];
  const walk = (docs, col) => {
    for (const d of docs ?? []) {
      const p = `${col}/${d.id}`;
      if (d.exists) state.set(p, d.data ?? {});
      else if (Object.keys(d.collections ?? {}).length) missingParents.push(p);
      for (const [name, sub] of Object.entries(d.collections ?? {})) walk(sub, `${p}/${name}`);
    }
  };
  for (const [name, docs] of Object.entries(raw ?? {})) walk(docs, name);
  state.missingParents = missingParents;
  return state;
}

export function cloneState(state) {
  const out = new Map([...state].map(([p, d]) => [p, structuredClone(d)]));
  out.missingParents = [...(state.missingParents ?? [])];
  return out;
}

const seg = (p) => p.split("/");

/** Season-shaped view of a state. Unknown paths are collected, not dropped. */
export function seasonView(state) {
  const seasons = new Map();
  const unknown = [];
  const get = (id) => {
    if (!seasons.has(id)) seasons.set(id, { id, data: null, audit: null, players: new Map(), games: new Map(), lineups: new Map(), otherPrivate: [] });
    return seasons.get(id);
  };
  for (const [p, data] of state) {
    const s = seg(p);
    if (s[0] !== "seasons") continue;
    const season = get(s[1]);
    if (s.length === 2) season.data = data;
    else if (s.length === 4 && s[2] === "private" && s[3] === "audit") season.audit = data;
    else if (s.length === 4 && s[2] === "players") {
      const pl = season.players.get(s[3]) ?? { id: s[3], data: null, profile: null };
      pl.data = data;
      season.players.set(s[3], pl);
    } else if (s.length === 6 && s[2] === "players" && s[4] === "private" && s[5] === "profile") {
      const pl = season.players.get(s[3]) ?? { id: s[3], data: null, profile: null };
      pl.profile = data;
      season.players.set(s[3], pl);
    } else if (s.length === 4 && s[2] === "games") {
      const g = season.games.get(s[3]) ?? { id: s[3], data: null, lines: new Map() };
      g.data = data;
      season.games.set(s[3], g);
    } else if (s.length === 6 && s[2] === "games" && s[4] === "lines") {
      const g = season.games.get(s[3]) ?? { id: s[3], data: null, lines: new Map() };
      g.lines.set(s[5], data);
      season.games.set(s[3], g);
    } else if (s.length === 4 && s[2] === "lineups") season.lineups.set(s[3], data);
    else unknown.push(p);
  }
  return { seasons, unknown };
}

export const docsUnder = (state, root) => [...state].filter(([p]) => seg(p)[0] === root && seg(p).length === 2).map(([p, d]) => ({ id: seg(p)[1], data: d }));

const pick = (data, keys) => Object.fromEntries(keys.filter((k) => data && k in data).map((k) => [k, data[k]]));
const omit = (data, keys) => Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !keys.includes(k)));
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
const statusOf = (d) => (d && "status" in d ? d.status : undefined);

// ---------------------------------------------------------------------------
// Ids

/** The app's opaque public roster id (src/lib/teamData.ts seasonPlayerDocId). */
export function seasonPlayerDocId(careerPlayerId, seasonId) {
  return `sp_${sha256(`${seasonId}\u0000${careerPlayerId}`).slice(0, 20)}`;
}

/**
 * The legacy team's id: opaque, deterministic for an unchanged set of legacy
 * seasons (so repeated plans agree), and derived from no name, uid, or email.
 */
export function legacyTeamIdFor(legacySeasonIds) {
  return `t_${sha256(`tallies-migration:v1:legacy-team\u0000${[...legacySeasonIds].sort().join("\u0000")}`).slice(0, 20)}`;
}

/** A roster doc id that embeds the entry's permanent identity id. */
export function identityKeyed(docId, careerPlayerId) {
  const c = str(careerPlayerId).toLowerCase();
  return c.length >= 8 && docId.toLowerCase().includes(c);
}

// ---------------------------------------------------------------------------
// Analysis and desired state

const finding = (code, path, detail) => ({ code, path, detail });

/**
 * Computes the full desired end state for every document in scope.
 * opts: { ownerUid, legacyTeamId?, acceptNoCurrent? }
 * Returns { desired: Map(path → data | null), decisions, blockers, warnings, ctx }.
 */
export function desiredState(state, opts = {}) {
  const blockers = [];
  const warnings = [];
  const decisions = [];
  const desired = new Map();
  const ledger = state.get(LEDGER_PATH) ?? null;
  const ownerUid = str(opts.ownerUid);
  const { seasons, unknown } = seasonView(state);

  // --- Unexpected structure -------------------------------------------------
  for (const p of state.missingParents ?? []) blockers.push(finding("missing-parent", p, "Document is missing but has data beneath it."));
  for (const p of unknown) blockers.push(finding("unknown-season-data", p, "Unclassified season data (public/private unknown)."));
  for (const [p] of state) if (!KNOWN_ROOTS.has(seg(p)[0])) warnings.push(finding("unexpected-collection", p, "Not part of the migration; left unchanged."));
  for (const s of seasons.values()) {
    if (!s.data) blockers.push(finding("missing-season-doc", `seasons/${s.id}`, "Season data exists without its season document."));
    // A re-key interrupted after its private profile was written leaves the
    // profile ahead of the entry; that is resumable, not an orphan.
    const targets = rekeyTargetsOf(s);
    for (const pl of s.players.values()) if (!pl.data && !targets.has(pl.id)) blockers.push(finding("orphan-private-profile", `seasons/${s.id}/players/${pl.id}/private/profile`, "Private profile without a roster entry."));
    for (const g of s.games.values()) if (!g.data) blockers.push(finding("missing-game-doc", `seasons/${s.id}/games/${g.id}`, "Game lines without a game document."));
  }

  // --- Owner (authorized source: admins allowlist + bound coach record) -----
  const admins = docsUnder(state, "admins").map((d) => d.id);
  let workspaceId = null;
  if (!ownerUid) blockers.push(finding("owner-missing", "admins", "Pass --owner-uid (the verified original coach uid); it is never inferred."));
  else {
    if (admins.length !== 1) blockers.push(finding("owner-ambiguous", "admins", `Expected exactly one legacy admin, found ${admins.length}.`));
    if (!admins.includes(ownerUid)) blockers.push(finding("owner-not-admin", `admins/${ownerUid}`, "The owner uid is not the legacy admins allowlist doc."));
    const coach = state.get(`coaches/${ownerUid}`);
    const ws = coach ? state.get(`coachWorkspaces/${coach.workspaceId}`) : null;
    if (!coach || coach.status !== "active" || !str(coach.workspaceId)) {
      blockers.push(finding("owner-not-bound", `coaches/${ownerUid}`, "No active coach record: run tools/coach-workspace-migrate.mjs (separately approved) after the owner's Google link."));
    } else if (!ws || ws.status !== "active" || ws.ownerUid !== ownerUid) {
      blockers.push(finding("owner-workspace-invalid", `coachWorkspaces/${coach.workspaceId}`, "The coach's workspace is missing, inactive, or owned by someone else."));
    } else workspaceId = coach.workspaceId;
  }
  if (ledger && ledger.ownerUid && ownerUid && ledger.ownerUid !== ownerUid) {
    blockers.push(finding("ledger-owner-mismatch", LEDGER_PATH, "A migration for a different owner was already started."));
  }

  // --- Teams and legacy seasons ---------------------------------------------
  const teams = new Map(docsUnder(state, "teams").map((t) => [t.id, t.data]));
  const legacyIds = new Set(
    Array.isArray(ledger?.legacySeasonIds)
      ? ledger.legacySeasonIds
      : [...seasons.values()].filter((s) => s.data && !str(s.data.teamId)).map((s) => s.id),
  );
  const explicit = str(opts.legacyTeamId);
  if (ledger?.legacyTeamId && explicit && ledger.legacyTeamId !== explicit) {
    blockers.push(finding("ledger-team-mismatch", LEDGER_PATH, `This migration already uses ${ledger.legacyTeamId} for the legacy seasons.`));
  }
  const legacyTeamId = legacyIds.size ? str(ledger?.legacyTeamId) || explicit || legacyTeamIdFor(legacyIds) : null;
  const adopting = !!legacyTeamId && teams.has(legacyTeamId) && (!!explicit || !!ledger?.adoptedTeam);
  if (!legacyIds.size) warnings.push(finding("no-legacy-seasons", "seasons", "No teamless legacy seasons; no team is created."));

  // Legacy identity: the legacy app labels teamless seasons from their own
  // teamName (else the built-in legacy default) and renders them with the
  // built-in legacy branding (src/lib/branding.ts LEGACY_TIGERS_BRANDING).
  let legacyTeam = null;
  if (legacyTeamId) {
    const names = [...new Set([...legacyIds].map((id) => str(seasons.get(id)?.data?.teamName)).filter(Boolean))];
    const leagues = [...new Set([...legacyIds].map((id) => str(seasons.get(id)?.data?.league)).filter(Boolean))];
    if (names.length > 1) blockers.push(finding("legacy-team-names-differ", "seasons", `Teamless seasons name different teams (${names.length}); they cannot become one team.`));
    const teamName = names[0] ?? LEGACY_TIGERS_BRANDING.teamName;
    decisions.push({ code: "legacy-team-name", value: teamName, source: names.length ? "teamless seasons' teamName" : "legacy app default (no season stores a name)" });
    if (!names.length) warnings.push(finding("legacy-name-default", "seasons", "No legacy season stores teamName; the legacy app's default label is used."));
    if (leagues.length && leagues.some((l) => l !== LEGACY_TIGERS_BRANDING.division)) {
      warnings.push(finding("legacy-league-differs", "seasons", "A season's league differs from the legacy branding division; the team keeps the division the legacy app shows; seasons keep their own league."));
    }
    const sameName = [...teams].filter(([id, t]) => id !== legacyTeamId && str(t.teamName).toLowerCase() === teamName.toLowerCase());
    if (sameName.length && !adopting) {
      blockers.push(finding("legacy-team-exists", `teams/${sameName[0][0]}`, `A team named "${teamName}" already exists. Pass --legacy-team ${sameName[0][0]} to put the legacy seasons into it, or rename it; the migration never creates a second ${teamName}.`));
    }
    if (adopting) {
      const t = teams.get(legacyTeamId);
      if (str(t.teamName).toLowerCase() !== teamName.toLowerCase()) blockers.push(finding("adopted-team-name-differs", `teams/${legacyTeamId}`, "The team to adopt has a different name than the legacy seasons."));
      decisions.push({ code: "legacy-team", value: legacyTeamId, source: "existing team adopted (--legacy-team)" });
    } else {
      const branding = { ...structuredClone(LEGACY_TIGERS_BRANDING), teamName };
      delete branding.teamId;
      const errors = validateBranding(branding);
      if (Object.keys(errors).length) blockers.push(finding("legacy-branding-invalid", "teams", JSON.stringify(errors)));
      legacyTeam = { teamId: legacyTeamId, ...pick(branding, BRANDING_FIELDS) };
      decisions.push({ code: "legacy-team", value: legacyTeamId, source: "new opaque team id (deterministic for these legacy seasons)" });
      decisions.push({ code: "legacy-branding", value: "legacy built-in branding (orange palettes, bundled tigers logo, Original awards)", source: "what the legacy app renders for teamless seasons" });
    }
  }

  // --- Season-level analysis -------------------------------------------------
  const teamOf = new Map();
  for (const s of seasons.values()) {
    if (!s.data) continue;
    const path = `seasons/${s.id}`;
    const st = statusOf(s.data);
    if (st !== undefined && !STATUSES.includes(st)) blockers.push(finding("invalid-status", path, `Unknown status ${JSON.stringify(st)}.`));
    const teamId = legacyIds.has(s.id) ? legacyTeamId : str(s.data.teamId);
    teamOf.set(s.id, teamId);
    if (legacyIds.has(s.id) && str(s.data.teamId) && s.data.teamId !== legacyTeamId) {
      blockers.push(finding("legacy-season-reassigned", path, "A legacy season now belongs to another team."));
    }
    if (!legacyIds.has(s.id) && !teams.has(teamId)) blockers.push(finding("broken-team-reference", path, `teamId ${JSON.stringify(s.data.teamId)} has no team document.`));
    if (s.data.ownerUid && ownerUid && s.data.ownerUid !== ownerUid) blockers.push(finding("foreign-owner", path, "Season already belongs to another owner."));
    if (s.data.branding && typeof s.data.branding === "object" && s.data.branding.teamId !== teamId) {
      blockers.push(finding("branding-team-mismatch", path, "The season's branding snapshot names another team."));
    }
    if (s.data.published === true && ["draft", "deleting"].includes(st)) blockers.push(finding("published-draft", path, "A draft is marked published."));
    if ("published" in s.data && typeof s.data.published !== "boolean") blockers.push(finding("invalid-published", path, "published is not a boolean."));
    if (!str(s.data.teamName) || !str(s.data.seasonLabel)) {
      warnings.push(finding("missing-season-labels", path, "teamName/seasonLabel missing; the app shows its legacy defaults (unchanged by this migration)."));
    }
  }
  for (const [id, t] of teams) {
    if (t.ownerUid && ownerUid && t.ownerUid !== ownerUid) blockers.push(finding("foreign-owner", `teams/${id}`, "Team already belongs to another owner."));
    const extra = Object.keys(t).filter((k) => !TEAM_KEYS.includes(k));
    if (extra.length) blockers.push(finding("team-unexpected-fields", `teams/${id}`, `Fields the Tallies rules reject: ${extra.join(", ")}.`));
    const errors = validateBranding({ ...pick(t, BRANDING_FIELDS), teamName: String(t.teamName ?? ""), shortName: String(t.shortName ?? ""), division: String(t.division ?? ""), logo: t.logo ?? null });
    if (Object.keys(errors).length) blockers.push(finding("team-branding-invalid", `teams/${id}`, JSON.stringify(errors)));
    if (t.teamId !== undefined && t.teamId !== id) blockers.push(finding("team-id-mismatch", `teams/${id}`, "teamId field differs from the document id."));
  }

  // --- Publication -------------------------------------------------------------
  const published = new Map();
  for (const s of seasons.values()) {
    if (!s.data) continue;
    const st = statusOf(s.data);
    let p;
    if (typeof s.data.published === "boolean") p = s.data.published;
    else p = legacyIds.has(s.id) && !["draft", "deleting"].includes(st);
    published.set(s.id, p);
    decisions.push({
      code: "publication",
      seasonId: s.id,
      value: p,
      source: typeof s.data.published === "boolean" ? "existing flag kept" : legacyIds.has(s.id) ? (p ? "legacy season parents see today" : "legacy draft stays hidden") : "not legacy: unpublished until the coach publishes",
    });
  }

  // --- Current season per team --------------------------------------------------
  const config = state.get("app/config");
  const configCurrent = str(config?.currentSeasonId);
  const current = new Map();
  const eligible = (id) => seasons.get(id)?.data && !["draft", "finalized", "deleting"].includes(statusOf(seasons.get(id).data));
  const allTeamIds = new Set([...teams.keys(), ...(legacyTeamId ? [legacyTeamId] : [])]);
  for (const tid of allTeamIds) {
    const existing = str(teams.get(tid)?.currentSeasonId);
    if (existing) {
      if (teamOf.get(existing) !== tid) blockers.push(finding("team-current-foreign", `teams/${tid}`, "currentSeasonId is not a season of this team."));
      current.set(tid, existing);
      decisions.push({ code: "current-season", teamId: tid, value: existing, source: "existing team setting kept" });
    }
  }
  if (configCurrent) {
    const tid = teamOf.get(configCurrent);
    if (!seasons.get(configCurrent)?.data) blockers.push(finding("config-current-missing", "app/config", "currentSeasonId names a season that does not exist."));
    else if (!current.has(tid)) {
      if (eligible(configCurrent)) {
        current.set(tid, configCurrent);
        decisions.push({ code: "current-season", teamId: tid, value: configCurrent, source: "app/config (legacy global setting, read only; never written)" });
      } else if (opts.acceptNoCurrent) {
        warnings.push(finding("config-current-ineligible", "app/config", "The legacy current season is draft/finalized/deleting; the team starts with no current season (accepted)."));
      } else {
        blockers.push(finding("config-current-ineligible", "app/config", "The legacy current season is draft/finalized/deleting and cannot be a team's current season. Re-plan with --accept-no-current to start the team without one."));
      }
    }
  } else warnings.push(finding("config-missing", "app/config", "No legacy current season; teams start without one."));
  for (const tid of allTeamIds) if (!current.has(tid)) decisions.push({ code: "current-season", teamId: tid, value: null, source: "none" });

  // --- Teams desired --------------------------------------------------------------
  for (const tid of allTeamIds) {
    const t = teams.get(tid);
    const base = t ? structuredClone(t) : { ...legacyTeam, createdAt: SERVER_TS, updatedAt: SERVER_TS };
    const next = { ...base, teamId: tid, ownerUid: t?.ownerUid ?? ownerUid, workspaceId: t?.workspaceId ?? workspaceId };
    if (current.get(tid)) next.currentSeasonId = current.get(tid);
    if (t && t.workspaceId && workspaceId && t.workspaceId !== workspaceId) blockers.push(finding("foreign-workspace", `teams/${tid}`, "Team belongs to another workspace."));
    desired.set(`teams/${tid}`, next);
  }
  // Pre-existing legacy team doc that this run did not create: must match.
  if (legacyTeam && teams.has(legacyTeamId) && !adopting && !ledger) {
    const t = teams.get(legacyTeamId);
    const want = { ...legacyTeam };
    for (const k of BRANDING_FIELDS) if (!sameValue(t[k], want[k])) blockers.push(finding("conflict-team", `teams/${legacyTeamId}`, `Existing ${k} differs from the legacy branding.`));
  }

  // --- Seasons and private audit ----------------------------------------------------
  for (const s of seasons.values()) {
    if (!s.data) continue;
    const path = `seasons/${s.id}`;
    const moved = pick(s.data, SEASON_PRIVATE);
    const next = omit(s.data, SEASON_PRIVATE);
    if (teamOf.get(s.id)) next.teamId = teamOf.get(s.id);
    next.ownerUid = s.data.ownerUid ?? ownerUid;
    next.published = published.get(s.id);
    desired.set(path, next);
    if (Object.keys(moved).length || s.audit) {
      const audit = { ...(s.audit ?? {}) };
      for (const [k, v] of Object.entries(moved)) {
        if (k in audit && !sameValue(audit[k], v)) blockers.push(finding("conflict-private-audit", `${path}/private/audit`, `${k} already holds a different value.`));
        audit[k] = v;
      }
      if (Object.keys(moved).length) audit.privacySplit = MIGRATION_ID;
      desired.set(`${path}/private/audit`, audit);
    }
  }

  // --- Roster entries: privacy split and re-keying ---------------------------------------
  const rekeys = [];
  const entries = []; // for career links, keyed by final ids
  const finalPlayers = []; // { seasonId, id, pub, priv, from }
  for (const s of seasons.values()) {
    if (!s.data) continue;
    const refs = referencedPlayerIds(s);
    const taken = new Set();
    // Entries whose re-key target already exists (interrupted run): the
    // target is produced from the source entry, not kept as its own entry.
    const rekeyTargets = rekeyTargetsOf(s);
    for (const pl of [...s.players.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (!pl.data) continue;
      const path = `seasons/${s.id}/players/${pl.id}`;
      if (rekeyTargets.has(pl.id)) continue;
      for (const k of PLAYER_PRIVATE) {
        if (pl.data && k in pl.data && pl.profile && k in pl.profile && !sameValue(pl.profile[k], pl.data[k])) {
          blockers.push(finding("conflict-private-profile", `${path}/private/profile`, `${k} already holds a different value.`));
        }
      }
      const moved = pick(pl.data, PLAYER_PRIVATE);
      const eff = { ...moved, ...pick(pl.profile, PLAYER_PRIVATE) };
      let id = pl.id;
      if (identityKeyed(pl.id, eff.careerPlayerId)) {
        id = seasonPlayerDocId(str(eff.careerPlayerId), s.id);
        const why = rekeyUnsafe(s, pl.id, refs, state);
        if (why) blockers.push(finding("rekey-unsafe", path, `Roster id embeds a permanent identity id but ${why}; it cannot be re-keyed safely.`));
        rekeys.push({ seasonId: s.id, from: pl.id, to: id });
      }
      if (taken.has(id)) blockers.push(finding("rekey-collision", path, `Two entries map to ${id}.`));
      taken.add(id);
      const pub = omit(pl.data, PLAYER_PRIVATE);
      if (id !== pl.id && "id" in pub) pub.id = id;
      const priv = Object.keys(moved).length || pl.profile ? { ...(pl.profile ?? {}), ...moved, ...(Object.keys(moved).length || id !== pl.id ? { privacySplit: MIGRATION_ID } : {}) } : null;
      if (id !== pl.id) {
        // A target left by an interrupted run must be exactly what this
        // entry becomes; anything else is never overwritten.
        const target = s.players.get(id);
        if (target?.data && !sameDoc(omit(target.data, ["careerLinks"]), pub)) blockers.push(finding("conflict-rekey-target", `seasons/${s.id}/players/${id}`, "An existing entry at the re-key target differs."));
        if (target?.profile && !sameDoc(target.profile, priv)) blockers.push(finding("conflict-rekey-target", `seasons/${s.id}/players/${id}/private/profile`, "An existing private profile at the re-key target differs."));
      }
      finalPlayers.push({ seasonId: s.id, id, from: pl.id, pub, priv });
      if (statusOf(s.data) !== "deleting") {
        entries.push({
          seasonId: s.id,
          seasonPlayerId: id,
          careerPlayerId: typeof eff.careerPlayerId === "string" ? eff.careerPlayerId : undefined,
          confirmed: eff.identityStatus === "confirmed",
          linkedFrom: normalizeLinkedFrom(eff.linkedFrom),
        });
      }
    }
  }
  // Re-keyed entries referenced from other entries' linkedFrom would break.
  const rekeyed = new Set(rekeys.map((r) => `${r.seasonId}/${r.from}`));
  for (const e of entries) {
    for (const r of e.linkedFrom) {
      if (rekeyed.has(`${r.seasonId}/${r.seasonPlayerId}`)) blockers.push(finding("rekey-referenced", `seasons/${e.seasonId}/players/${e.seasonPlayerId}`, "linkedFrom points at an entry that would be re-keyed."));
    }
  }
  for (const r of rekeys) decisions.push({ code: "rekey", seasonId: r.seasonId, from: r.from, to: r.to, source: "roster id embedded a permanent identity id" });

  const visible = new Set([...published].filter(([id, p]) => p && statusOf(seasons.get(id)?.data) !== "deleting").map(([id]) => id));
  const links = computeCareerLinks(entries, visible);
  for (const fp of finalPlayers) {
    const want = links.get(`${fp.seasonId}/${fp.id}`) ?? [];
    const pub = { ...fp.pub };
    if (want.length) pub.careerLinks = want;
    else delete pub.careerLinks;
    desired.set(`seasons/${fp.seasonId}/players/${fp.id}`, pub);
    if (fp.priv) desired.set(`seasons/${fp.seasonId}/players/${fp.id}/private/profile`, fp.priv);
    if (fp.from !== fp.id) {
      desired.set(`seasons/${fp.seasonId}/players/${fp.from}`, null);
      if (state.has(`seasons/${fp.seasonId}/players/${fp.from}/private/profile`)) desired.set(`seasons/${fp.seasonId}/players/${fp.from}/private/profile`, null);
    }
  }

  // --- Public team projections ----------------------------------------------------------
  for (const tid of allTeamIds) {
    const t = desired.get(`teams/${tid}`);
    const cur = current.get(tid) ?? null;
    const proj = {
      ...pick(t, BRANDING_FIELDS),
      logo: t.logo ?? null,
      currentSeasonId: cur && published.get(cur) && teamOf.get(cur) === tid ? cur : null,
      updatedAt: SERVER_TS,
    };
    const existing = state.get(`publicTeams/${tid}`);
    if (existing) {
      const { updatedAt, ...cmp } = proj;
      if (!sameDoc(omit(existing, ["updatedAt"]), cmp)) blockers.push(finding("conflict-public-team", `publicTeams/${tid}`, "An existing public team projection differs from the planned one."));
      proj.updatedAt = existing.updatedAt ?? updatedAt;
    }
    desired.set(`publicTeams/${tid}`, proj);
  }

  // --- Everything else is kept exactly -----------------------------------------------------
  for (const [p, d] of state) if (!desired.has(p) && p !== LEDGER_PATH) desired.set(p, d);

  return {
    desired,
    decisions,
    blockers,
    warnings,
    ctx: { ownerUid, workspaceId, legacyTeamId, legacySeasonIds: [...legacyIds].sort(), adoptedTeam: adopting, published, current, teamOf, rekeys },
  };
}

/** Opaque ids that identity-keyed entries of a season are re-keyed to. */
function rekeyTargetsOf(s) {
  const out = new Set();
  for (const pl of s.players.values()) {
    if (!pl.data) continue;
    const eff = { ...pick(pl.data, PLAYER_PRIVATE), ...pick(pl.profile, PLAYER_PRIVATE) };
    if (identityKeyed(pl.id, eff.careerPlayerId)) out.add(seasonPlayerDocId(str(eff.careerPlayerId), s.id));
  }
  return out;
}

/** Player ids a season's records refer to (awards, layouts, games, lineups). */
function referencedPlayerIds(s) {
  const ids = new Set();
  const add = (v) => typeof v === "string" && v && ids.add(v);
  for (const v of Object.values(s.data?.finalAwards ?? {})) add(v);
  for (const k of Object.keys(s.data?.recognitionLayouts ?? {})) add(k);
  for (const g of s.games.values()) {
    for (const k of g.lines.keys()) add(k);
    for (const l of g.lines.values()) add(l?.playerId);
    for (const a of Object.values(g.data?.coachAwards ?? {})) add(a?.playerId);
    add(g.data?.gameBall?.playerId);
    for (const r of g.data?.lineupSnapshot?.rows ?? []) add(r?.playerId);
  }
  for (const l of s.lineups.values()) for (const r of l?.rows ?? []) add(r?.playerId);
  return ids;
}

function rekeyUnsafe(s, playerId, refs, state) {
  if (refs.has(playerId)) return "the season's records refer to it";
  if (s.games.size || s.lineups.size) return "the season has games or lineups";
  const prefix = `seasons/${s.id}/players/${playerId}/`;
  for (const [p] of state) if (p.startsWith(prefix) && p !== `${prefix}private/profile`) return "it has other subcollections";
  return null;
}

// ---------------------------------------------------------------------------
// Plan

const PHASES = ["private", "teams", "seasons", "players", "deletes", "public"];

function phaseOf(path, action) {
  const s = seg(path);
  if (action === "delete") return "deletes";
  if (s[0] === "teams") return "teams";
  if (s[0] === "publicTeams") return "public";
  if (s.includes("private")) return "private";
  if (s.length === 2) return "seasons";
  return "players";
}

/** Field-level operations that turn `state` into `desired`. */
export function diffOps(state, desired) {
  const ops = [];
  for (const [path, want] of desired) {
    const have = state.get(path);
    if (want === null) {
      if (have) ops.push({ path, action: "delete", before: have });
      continue;
    }
    if (!have) {
      ops.push({ path, action: "create", after: want });
      continue;
    }
    const before = {};
    const after = {};
    for (const k of new Set([...Object.keys(have), ...Object.keys(want)])) {
      const a = k in have ? have[k] : ABSENT;
      const b = k in want ? want[k] : ABSENT;
      if (!sameValue(a, b)) {
        before[k] = a;
        after[k] = b;
      }
    }
    if (Object.keys(after).length) ops.push({ path, action: "update", before, after });
  }
  ops.forEach((o) => (o.phase = phaseOf(o.path, o.action)));
  // A new roster entry (re-key) is created together with its private
  // profile, so no profile ever exists without its entry.
  const created = new Set(ops.filter((o) => o.action === "create").map((o) => o.path));
  for (const o of ops) if (o.action === "create" && /\/players\/[^/]+\/private\/profile$/.test(o.path) && created.has(o.path.replace(/\/private\/profile$/, ""))) o.phase = "players";
  ops.sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || a.path.localeCompare(b.path));
  ops.forEach((o, i) => (o.seq = i + 1));
  return ops;
}

/**
 * Digest of the desired end state. Stable while a plan is being applied
 * (team/public timestamps are normalized; the ledger is excluded), and
 * different as soon as any source document changes.
 */
export function targetDigest(desired) {
  const rows = [];
  for (const [p, d] of [...desired].sort(([a], [b]) => a.localeCompare(b))) {
    if (d === null || p === LEDGER_PATH) continue;
    let v = d;
    if (/^(teams|publicTeams)\/[^/]+$/.test(p)) v = { ...d, createdAt: "<ts>", updatedAt: "<ts>" };
    rows.push(`${p}\u0000${canonical(v)}`);
  }
  return sha256(rows.join("\n"));
}

export function expectedCounts(desired) {
  const c = {};
  for (const [p, d] of desired) {
    if (d === null || p === LEDGER_PATH) continue;
    const key = seg(p).map((x, i) => (i % 2 ? "*" : x)).join("/");
    c[key] = (c[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(c).sort());
}

/** The reviewable plan. Deterministic for the same state and options. */
export function buildPlan(state, opts = {}, source = {}) {
  const r = desiredState(state, opts);
  const ops = diffOps(state, r.desired);
  const body = {
    kind: "tallies-migration-plan",
    version: PLAN_VERSION,
    migrationId: MIGRATION_ID,
    source: { projectId: source.projectId ?? null, exportedAt: source.exportedAt ?? null, sha256: source.sha256 ?? null },
    options: { ownerUid: r.ctx.ownerUid, legacyTeamId: opts.legacyTeamId ?? null, acceptNoCurrent: !!opts.acceptNoCurrent },
    ownerUid: r.ctx.ownerUid,
    workspaceId: r.ctx.workspaceId,
    legacyTeamId: r.ctx.legacyTeamId,
    legacySeasonIds: r.ctx.legacySeasonIds,
    adoptedTeam: r.ctx.adoptedTeam,
    targetDigest: targetDigest(r.desired),
    seasons: [...seasonView(state).seasons.values()].filter((s) => s.data).map((s) => ({
      seasonId: s.id,
      teamId: r.ctx.teamOf.get(s.id) || null,
      status: statusOf(s.data) ?? "legacy (no status)",
      published: r.ctx.published.get(s.id),
      current: [...r.ctx.current.values()].includes(s.id),
      players: [...s.players.values()].filter((p) => p.data).length,
      games: s.games.size,
      lineups: s.lineups.size,
    })).sort((a, b) => a.seasonId.localeCompare(b.seasonId)),
    idMap: r.ctx.rekeys,
    decisions: r.decisions,
    blockers: r.blockers,
    warnings: r.warnings,
    expectedCounts: expectedCounts(r.desired),
    summary: summarizeOps(ops),
    ops,
  };
  return { ...body, planHash: sha256(canonical(body)) };
}

export function summarizeOps(ops) {
  const out = {};
  for (const o of ops) {
    const k = `${o.phase}:${o.action}`;
    out[k] = (out[k] ?? 0) + 1;
  }
  return { total: ops.length, ...out };
}

/**
 * Transaction units: ops of one phase, never splitting a document from its
 * private profile/audit, at most `size` ops each (unless one group is
 * larger). Apply and rollback commit one unit per transaction.
 */
export function chunkOps(ops, size = 100) {
  const groups = [];
  const index = new Map();
  for (const op of ops) {
    const key = `${op.phase}|${op.path.replace(/\/private\/(profile|audit)$/, "")}`;
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push([]);
    }
    groups[index.get(key)].push(op);
  }
  const out = [];
  let cur = [];
  for (const g of groups) {
    if (cur.length && (cur.length + g.length > size || cur[0].phase !== g[0].phase)) {
      out.push(cur);
      cur = [];
    }
    cur.push(...g);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Ancestor documents that are missing while something exists beneath. */
export function missingParentsOf(state) {
  const out = new Set();
  for (const [p] of state) {
    const s = seg(p);
    for (let i = 2; i < s.length; i += 2) {
      const parent = s.slice(0, i).join("/");
      if (!state.has(parent)) out.add(parent);
    }
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// Classification (used by apply and rollback, and by the in-memory simulator)

/**
 * "apply" (doc is in the planned before-state), "unchanged" (already in the
 * after-state), or "conflict" (anything else: never overwritten).
 */
export function classify(op, have) {
  if (op.action === "create") {
    if (!have) return "apply";
    return sameDoc(have, op.after) ? "unchanged" : "conflict";
  }
  if (op.action === "delete") {
    if (!have) return "unchanged";
    return sameDoc(have, op.before) ? "apply" : "conflict";
  }
  if (!have) return "conflict";
  const keys = Object.keys(op.after);
  if (keys.every((k) => sameValue(have[k], op.after[k]))) return "unchanged";
  if (keys.every((k) => sameValue(have[k], op.before[k]))) return "apply";
  return "conflict";
}

/** Rollback classification: "restore", "unchanged" (already before), "conflict". */
export function classifyRollback(op, have) {
  if (op.action === "create") {
    if (!have) return "unchanged";
    return sameDoc(have, op.after) ? "restore" : "conflict";
  }
  if (op.action === "delete") {
    if (!have) return "restore";
    return sameDoc(have, op.before) ? "unchanged" : "conflict";
  }
  if (!have) return "conflict";
  const keys = Object.keys(op.after);
  if (keys.every((k) => sameValue(have[k], op.before[k]))) return "unchanged";
  if (keys.every((k) => sameValue(have[k], op.after[k]))) return "restore";
  return "conflict";
}

const STAMP = { __timestamp: "2000-01-01T00:00:00.000Z" };
const resolve = (v) => (isServerTs(v) ? STAMP : v);

/** Applies ops to an in-memory state (tests and dry-run previews). */
export function simulateApply(state, ops) {
  const next = cloneState(state);
  const counts = { applied: 0, unchanged: 0, conflict: 0 };
  for (const op of ops) {
    const c = classify(op, next.get(op.path));
    counts[c === "apply" ? "applied" : c]++;
    if (c === "conflict") throw Object.assign(new Error(`conflict at ${op.path}`), { op });
    if (c !== "apply") continue;
    if (op.action === "delete") next.delete(op.path);
    else if (op.action === "create") next.set(op.path, Object.fromEntries(Object.entries(op.after).map(([k, v]) => [k, resolve(v)])));
    else {
      const d = { ...next.get(op.path) };
      for (const [k, v] of Object.entries(op.after)) {
        if (isAbsent(v)) delete d[k];
        else d[k] = resolve(v);
      }
      next.set(op.path, d);
    }
  }
  next.missingParents = missingParentsOf(next);
  return { state: next, counts };
}

export { normalizeCareerLinks };
