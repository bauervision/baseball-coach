// Team-scoped Admin data operations (Tallies, firestore.target.rules).
//
// Same behavior as the legacy Admin actions, in the multi-coach shapes:
// - teams/{t} carry ownerUid + workspaceId (immutable); publicTeams/{t} is
//   written in the same transaction (rules check it matches).
// - seasons carry teamId + ownerUid; new seasons start draft + unpublished.
// - lifecycle audit lives in seasons/{s}/private/audit, never the season doc.
// - roster identity (careerPlayerId, identityStatus, linkedFrom) and shirt
//   size live in seasons/{s}/players/{p}/private/profile; public roster
//   docs never carry them, and new public doc ids never reveal the identity.
// - app/config is never read or written.
// Every write first re-reads the season and checks it belongs to the
// selected team (assertSeasonInTeam); rules enforce ownership regardless.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";

import {
  normalizeBranding,
  sameBranding,
  snapshotFromTeam,
  validateBranding,
  type Team,
} from "@/lib/branding";
import { assertSeasonInTeam, requireTeam, type AdminDataScope, type ScopedTeam } from "@/lib/adminScope";
import { normalizeLinkedFrom } from "@/lib/careerHistory";
import { careerPlayerIdForEdit } from "@/lib/playerIdentity";
import {
  planRosterAdditions,
  rosterRemovalBlocker,
  type ImportSelection,
  type NewPlayerDraft,
  type RosterAdditionPlan,
} from "@/lib/rosterPlanning";
import { isFinalized, planFinalize, planReopen, type LifecycleEvent } from "@/lib/seasonLifecycle";
import { DELETE_BATCH, rosterBlockers, seasonDocBlockers } from "@/lib/draftDeletion";
import { seasonSummaryFromData, type SeasonSummary } from "@/lib/seasonStore";
import { publicTeamProjection, refreshCareerLinks } from "@/lib/teamPublication";
import { seasonSortKey } from "@/lib/seasonOrder";

/** Fields that never appear in a public roster doc. */
export const PLAYER_PRIVATE_FIELDS = ["shirtSize", "careerPlayerId", "identityStatus", "identityMigration", "linkedFrom"] as const;

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Opaque ids: never a name, email, uid, or place. */
export function newOpaqueTeamId(): string {
  return `t_${randomHex(10)}`;
}
export function newOpaqueSeasonId(): string {
  return `s_${randomHex(10)}`;
}

/**
 * Public roster doc id for a player identity in one season: stable (so a
 * repeated import finds the same doc) but not the identity itself, and not
 * linkable across seasons.
 */
export async function seasonPlayerDocId(careerPlayerId: string, seasonId: string): Promise<string> {
  const data = new TextEncoder().encode(`${seasonId}\u0000${careerPlayerId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return `sp_${[...digest.slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function splitPlayerFields(data: Record<string, unknown>) {
  const pub: Record<string, unknown> = {};
  const priv: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if ((PLAYER_PRIVATE_FIELDS as readonly string[]).includes(k)) priv[k] = v;
    else pub[k] = v;
  }
  return { pub, priv };
}

// ------------------------------------------------------------------ teams

function teamFromDoc(id: string, d: DocumentData): ScopedTeam | null {
  const b = normalizeBranding({ ...d, teamId: id });
  if (!b) return null;
  return {
    ...b,
    teamId: id,
    workspaceId: typeof d.workspaceId === "string" ? d.workspaceId : "",
    currentSeasonId: typeof d.currentSeasonId === "string" && d.currentSeasonId ? d.currentSeasonId : null,
  };
}

/** The coach's own teams (scoped query). */
export async function listScopedTeams(db: Firestore, uid: string): Promise<ScopedTeam[]> {
  const snap = await getDocs(query(collection(db, "teams"), where("ownerUid", "==", uid)));
  return snap.docs
    .map((d) => teamFromDoc(d.id, d.data()))
    .filter((t): t is ScopedTeam => t !== null)
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
}

/** One team the coach owns; null when missing or not theirs (rules deny). */
export async function readScopedTeam(db: Firestore, teamId: string): Promise<ScopedTeam | null> {
  try {
    const snap = await getDoc(doc(db, "teams", teamId));
    return snap.exists() ? teamFromDoc(snap.id, snap.data()) : null;
  } catch {
    return null;
  }
}

function brandingFields(team: Team) {
  const s = snapshotFromTeam(team);
  return {
    teamName: s.teamName,
    shortName: s.shortName,
    sport: s.sport,
    division: s.division,
    logo: s.logo,
    palettes: s.palettes,
    awardCollection: s.awardCollection,
  };
}

function assertValid(team: Team): void {
  const first = Object.values(validateBranding(team))[0];
  if (first) throw new Error(first);
}

/**
 * Creates a team owned by the signed-in coach in their workspace, with its
 * public projection, in one transaction. Retry-safe: the caller keeps the
 * id for the whole attempt, and an id that already holds this coach's team
 * with the same identity is recovered rather than duplicated.
 */
export async function createScopedTeam(
  db: Firestore,
  scope: AdminDataScope,
  team: Team,
): Promise<"created" | "recovered"> {
  assertValid(team);
  const ref = doc(db, "teams", team.teamId);
  try {
    await runTransaction(db, async (tx) => {
      if ((await tx.get(ref)).exists()) throw new Error("already exists");
      const fields = brandingFields(team);
      tx.set(ref, {
        teamId: team.teamId,
        ...fields,
        ownerUid: scope.uid,
        workspaceId: scope.workspaceId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      tx.set(doc(db, "publicTeams", team.teamId), publicTeamProjection(fields, null));
    });
    return "created";
  } catch (e) {
    // Lost response or double submit: same coach, same team → recovered.
    const existing = await readScopedTeam(db, team.teamId);
    if (existing && sameBranding(snapshotFromTeam(existing), snapshotFromTeam(team))) return "recovered";
    if (e instanceof Error && e.message === "already exists") throw new Error("A different team already uses this id.");
    throw e;
  }
}

/**
 * Saves the selected team's identity and its public projection together.
 * Ownership, workspace, current season, and creation time never change;
 * seasons keep their own branding snapshots (history is not rewritten).
 */
export async function updateScopedTeam(db: Firestore, scope: AdminDataScope, team: Team): Promise<void> {
  assertValid(team);
  const selected = requireTeam(scope);
  if (team.teamId !== selected.teamId) throw new Error("You can only edit the selected team.");
  const ref = doc(db, "teams", team.teamId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().ownerUid !== scope.uid) throw new Error("This team no longer exists.");
    const current = snap.data().currentSeasonId;
    let publicCurrent: string | null = null;
    if (typeof current === "string" && current) {
      const s = await tx.get(doc(db, "seasons", current));
      publicCurrent = s.exists() && s.data().published === true ? current : null;
    }
    const fields = brandingFields(team);
    tx.update(ref, { ...fields, updatedAt: serverTimestamp() });
    tx.set(doc(db, "publicTeams", team.teamId), publicTeamProjection(fields, publicCurrent));
  });
}

// ---------------------------------------------------------------- seasons

/** The selected team's seasons (owner query), newest first, with audit history. */
export async function listScopedSeasons(db: Firestore, scope: AdminDataScope): Promise<SeasonSummary[]> {
  if (!scope.team) return [];
  const snap = await getDocs(
    query(collection(db, "seasons"), where("ownerUid", "==", scope.uid), where("teamId", "==", scope.team.teamId)),
  );
  const audits = await Promise.all(
    snap.docs.map((d) => getDoc(doc(db, "seasons", d.id, "private", "audit")).catch(() => null)),
  );
  return snap.docs
    .map((d, i) => {
      const a = audits[i];
      const audit = a && a.exists() ? a.data() : {};
      return seasonSummaryFromData(d.id, { ...d.data(), lifecycleHistory: audit.lifecycleHistory ?? [] });
    })
    .sort((a, b) => seasonSortKey(b.seasonLabel, b.createdAtMs) - seasonSortKey(a.seasonLabel, a.createdAtMs));
}

async function readSeasonInTeam(db: Firestore, scope: AdminDataScope, seasonId: string): Promise<DocumentData> {
  const snap = await getDoc(doc(db, "seasons", seasonId)).catch(() => null);
  const data = snap?.exists() ? snap.data() : null;
  assertSeasonInTeam(scope, seasonId, data);
  return data!;
}

/**
 * Creates a draft season for the selected team (unpublished, not current),
 * or resumes the team's existing draft with the same label — so a retried
 * or doubled submit never creates a second season. A non-draft season with
 * that label is refused.
 */
export async function createScopedSeason(
  db: Firestore,
  scope: AdminDataScope,
  opts: { seasonLabel: string; scheduledGames: number; usesGamesPlayedRecord?: boolean },
): Promise<{ seasonId: string; outcome: "created" | "resumed" }> {
  const team = requireTeam(scope);
  const seasonLabel = opts.seasonLabel.trim() || "Season";
  const same = await getDocs(
    query(
      collection(db, "seasons"),
      where("ownerUid", "==", scope.uid),
      where("teamId", "==", team.teamId),
      where("seasonLabel", "==", seasonLabel),
      limit(1),
    ),
  );
  if (!same.empty) {
    const d = same.docs[0];
    if (d.data().status === "draft") return { seasonId: d.id, outcome: "resumed" };
    throw new Error(`${team.teamName} already has a ${seasonLabel} season.`);
  }
  const seasonId = newOpaqueSeasonId();
  const ref = doc(db, "seasons", seasonId);
  await runTransaction(db, async (tx) => {
    tx.set(ref, {
      teamId: team.teamId,
      ownerUid: scope.uid,
      teamName: team.teamName.trim(),
      league: team.division.trim(),
      branding: snapshotFromTeam(team),
      seasonLabel,
      record: { wins: 0, losses: 0, ties: 0 },
      usesGamesPlayedRecord: opts.usesGamesPlayedRecord === true,
      scheduledGames: Math.max(0, Math.floor(opts.scheduledGames)),
      gamesPlayed: 0,
      status: "draft",
      published: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  return { seasonId, outcome: "created" };
}


/** Finalizes (read-only) a season of the selected team; audit in private/audit. */
export async function finalizeScopedSeason(
  db: Firestore,
  scope: AdminDataScope,
  seasonId: string,
): Promise<{ alreadyFinalized: boolean }> {
  await readSeasonInTeam(db, scope, seasonId);
  const ref = doc(db, "seasons", seasonId);
  const auditRef = doc(db, "seasons", seasonId, "private", "audit");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const audit = await tx.get(auditRef);
    if (!snap.exists()) throw new Error(`Season "${seasonId}" does not exist.`);
    assertSeasonInTeam(scope, seasonId, snap.data());
    const history = audit.exists() && Array.isArray(audit.data().lifecycleHistory) ? audit.data().lifecycleHistory : [];
    const plan = planFinalize({ ...snap.data(), lifecycleHistory: history }, scope.uid, new Date().toISOString());
    if (plan.alreadyFinalized) return { alreadyFinalized: true };
    tx.update(ref, { status: "finalized", finalizedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    tx.set(auditRef, { lifecycleHistory: plan.history, finalizedByUid: scope.uid }, { merge: true });
    return { alreadyFinalized: false };
  });
}

/** Reopens a finalized season (editable; not made current). */
export async function reopenScopedSeason(db: Firestore, scope: AdminDataScope, seasonId: string): Promise<void> {
  await readSeasonInTeam(db, scope, seasonId);
  const ref = doc(db, "seasons", seasonId);
  const auditRef = doc(db, "seasons", seasonId, "private", "audit");
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const audit = await tx.get(auditRef);
    if (!snap.exists()) throw new Error(`Season "${seasonId}" does not exist.`);
    assertSeasonInTeam(scope, seasonId, snap.data());
    const a = audit.exists() ? audit.data() : {};
    const plan = planReopen(
      { ...snap.data(), lifecycleHistory: Array.isArray(a.lifecycleHistory) ? a.lifecycleHistory : [], finalizedByUid: a.finalizedByUid },
      scope.uid,
      new Date().toISOString(),
    );
    tx.update(ref, { status: "active", reopenedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    tx.set(auditRef, { lifecycleHistory: plan.history, reopenedByUid: scope.uid }, { merge: true });
  });
}

export class ScopedDraftNotDeletableError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(reasons.join(" "));
    this.reasons = reasons;
    this.name = "DraftNotDeletableError";
  }
}

async function appendAudit(db: Firestore, scope: AdminDataScope, seasonId: string, action: LifecycleEvent["action"], fromStatus: LifecycleEvent["fromStatus"], status: string) {
  const ref = doc(db, "seasons", seasonId);
  const auditRef = doc(db, "seasons", seasonId, "private", "audit");
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const audit = await tx.get(auditRef);
    if (!snap.exists()) return;
    const history = audit.exists() && Array.isArray(audit.data().lifecycleHistory) ? audit.data().lifecycleHistory : [];
    const event: LifecycleEvent = { action, at: new Date().toISOString(), byUid: scope.uid, fromStatus };
    tx.update(ref, { status, updatedAt: serverTimestamp() });
    tx.set(auditRef, { lifecycleHistory: [...history, event] }, { merge: true });
  });
}

/**
 * Deletes an unused draft of the selected team (same lock → verify →
 * delete protocol as the legacy Admin): its roster entries and their
 * private profiles, the audit doc, then the season. Never the team,
 * identities, or other seasons.
 */
export async function deleteScopedDraft(
  db: Firestore,
  scope: AdminDataScope,
  seasonId: string,
): Promise<{ outcome: "deleted" | "alreadyDeleted"; removedPlayers: number }> {
  const team = requireTeam(scope);
  const seasonRef = doc(db, "seasons", seasonId);
  const first = await getDoc(seasonRef).catch(() => null);
  if (!first?.exists()) return { outcome: "alreadyDeleted", removedPlayers: 0 };
  assertSeasonInTeam(scope, seasonId, first.data());

  if (first.data().status !== "deleting") {
    const teamSnap = await getDoc(doc(db, "teams", team.teamId));
    const reasons = seasonDocBlockers(first.data(), { isCurrent: teamSnap.data()?.currentSeasonId === seasonId });
    if (first.data().status !== "draft" && !reasons.length) reasons.push("Only draft seasons can be deleted.");
    if (first.data().published === true) reasons.push("Unpublish the season first.");
    if (reasons.length) throw new ScopedDraftNotDeletableError(reasons);
    await appendAudit(db, scope, seasonId, "deletionStarted", "draft", "deleting");
  }

  const [games, lineups, players] = await Promise.all([
    getDocs(query(collection(db, "seasons", seasonId, "games"), limit(1))),
    getDocs(query(collection(db, "seasons", seasonId, "lineups"), limit(1))),
    getDocs(collection(db, "seasons", seasonId, "players")),
  ]);
  const reasons = [
    ...(games.empty ? [] : ["The season has games."]),
    ...(lineups.empty ? [] : ["The season has a saved lineup."]),
    ...rosterBlockers(players.docs.map((d) => ({ id: d.id, data: d.data() }))),
  ];
  if (reasons.length) {
    await appendAudit(db, scope, seasonId, "deletionCancelled", "deleting", "draft");
    throw new ScopedDraftNotDeletableError(reasons);
  }

  for (let i = 0; i < players.docs.length; i += DELETE_BATCH / 2) {
    const batch = writeBatch(db);
    for (const d of players.docs.slice(i, i + DELETE_BATCH / 2)) {
      batch.delete(doc(db, "seasons", seasonId, "players", d.id, "private", "profile"));
      batch.delete(d.ref);
    }
    await batch.commit();
  }
  const final = writeBatch(db);
  final.delete(doc(db, "seasons", seasonId, "private", "audit"));
  final.delete(seasonRef);
  await final.commit();
  return { outcome: "deleted", removedPlayers: players.size };
}

// ----------------------------------------------------------------- roster

/** Effective roster entries (public doc + private profile) of one season. */
export async function readScopedRoster(db: Firestore, seasonId: string) {
  const players = await getDocs(collection(db, "seasons", seasonId, "players"));
  const profiles = await Promise.all(
    players.docs.map((p) => getDoc(doc(db, "seasons", seasonId, "players", p.id, "private", "profile")).catch(() => null)),
  );
  return players.docs.map((p, i) => {
    const prof = profiles[i];
    return { id: p.id, data: { ...p.data(), ...(prof && prof.exists() ? prof.data() : {}) } as DocumentData };
  });
}

function assertOpen(data: DocumentData, seasonId: string) {
  if (isFinalized(data)) {
    const label = String(data.seasonLabel ?? seasonId);
    throw new Error(`${label} is finalized and read-only. Reopen it to make changes.`);
  }
}

type PlayerEdit = {
  name: string;
  number: string;
  shirtSize: string;
  leaderboardHidden: boolean;
  returningPlayer: boolean;
  dirty: boolean;
};

/** Saves roster edits: display fields public, shirt size and identity private. */
export async function saveScopedPlayerEdits(opts: {
  db: Firestore;
  scope: AdminDataScope;
  seasonId: string;
  players: Array<{ id: string; careerPlayerId?: string }>;
  edits: Record<string, PlayerEdit>;
  parseNumber: (v: string) => number;
}): Promise<{ wrote: number }> {
  const { db, scope, seasonId, players, edits } = opts;
  if (players.length === 0) throw new Error("No players in roster.");
  assertOpen(await readSeasonInTeam(db, scope, seasonId), seasonId);
  const batch = writeBatch(db);
  let wrote = 0;
  for (const p of players) {
    const edit = edits[p.id];
    if (!edit || !edit.dirty) continue;
    const name = edit.name.trim();
    if (!name) throw new Error("Player name cannot be empty.");
    const { careerPlayerId } = careerPlayerIdForEdit(p.careerPlayerId);
    const shirtSize = edit.shirtSize.trim();
    batch.set(
      doc(db, "seasons", seasonId, "players", p.id),
      {
        name,
        number: opts.parseNumber(edit.number),
        leaderboardHidden: edit.leaderboardHidden === true,
        returningPlayer: edit.returningPlayer === true,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(
      doc(db, "seasons", seasonId, "players", p.id, "private", "profile"),
      { careerPlayerId, shirtSize: shirtSize ? shirtSize : null },
      { merge: true },
    );
    wrote++;
  }
  if (wrote === 0) throw new Error("No changes to save.");
  await batch.commit();
  return { wrote };
}

/**
 * Adds returning and new players to a season of the selected team: public
 * entry + private profile per player, additive only, idempotent (stable doc
 * ids). Returning players may come only from this team's seasons.
 */
export async function addScopedRosterPlayers(opts: {
  db: Firestore;
  scope: AdminDataScope;
  seasonId: string;
  imports: ImportSelection[];
  newPlayers: NewPlayerDraft[];
}): Promise<RosterAdditionPlan> {
  const { db, scope, seasonId } = opts;
  const season = await readSeasonInTeam(db, scope, seasonId);
  assertOpen(season, seasonId);
  for (const i of opts.imports) {
    if (i.linkedFrom.some((r) => !scope.seasonIds?.has(r.seasonId))) {
      throw new Error("Returning players can only come from this team's seasons.");
    }
  }
  const existing = await readScopedRoster(db, seasonId);
  const plan = planRosterAdditions({
    existing: existing.map(({ id, data }) => ({
      id,
      name: typeof data.name === "string" ? data.name : "",
      number: typeof data.number === "number" ? data.number : 0,
      careerPlayerId: typeof data.careerPlayerId === "string" ? data.careerPlayerId : undefined,
      linkedFrom: normalizeLinkedFrom(data.linkedFrom),
    })),
    imports: opts.imports,
    newPlayers: opts.newPlayers,
  });
  if (plan.writes.length === 0) return plan;

  const ids = await Promise.all(plan.writes.map((w) => seasonPlayerDocId(w.data.careerPlayerId, seasonId)));
  let written: typeof plan.writes = [];
  await runTransaction(db, async (tx) => {
    const refs = ids.map((id) => doc(db, "seasons", seasonId, "players", id));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    written = [];
    plan.writes.forEach((w, i) => {
      if (snaps[i].exists()) return; // added concurrently; keep what is there
      const { pub, priv } = splitPlayerFields({ ...w.data, id: ids[i] });
      tx.set(refs[i], { ...pub, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.set(doc(refs[i], "private", "profile"), priv);
      written.push({ ...w, seasonPlayerId: ids[i] });
    });
  });
  if (written.length && season.published === true) await refreshCareerLinks(db, scope.uid);

  const writtenKeys = new Set(written.map((w) => w.data.careerPlayerId));
  return {
    writes: written,
    skipped: [
      ...plan.skipped,
      ...plan.writes.filter((w) => !writtenKeys.has(w.data.careerPlayerId)).map((w) => ({ name: w.data.name, reason: "already-on-roster" as const })),
    ],
    warnings: plan.warnings,
  };
}

/**
 * Removes a roster entry added by mistake (same blockers as the legacy
 * Admin; links are checked across this team's seasons). Deletes the public
 * entry and its private profile together.
 */
export async function removeScopedRosterPlayer(opts: {
  db: Firestore;
  scope: AdminDataScope;
  seasonId: string;
  seasonPlayerId: string;
  confirmName: string;
  scan: (seasonId: string) => Promise<{ lineIds: Set<string>; gameAwardIds: Set<string>; finalAwardIds: Set<string>; layoutIds: Set<string> }>;
}): Promise<void> {
  const { db, scope, seasonId, seasonPlayerId } = opts;
  assertOpen(await readSeasonInTeam(db, scope, seasonId), seasonId);
  const ref = doc(db, "seasons", seasonId, "players", seasonPlayerId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("That player is not on this roster.");
  const name = String(snap.data().name ?? "").trim();
  if (opts.confirmName.trim() !== name) throw new Error(`Type ${name} exactly to confirm removal.`);

  const scan = await opts.scan(seasonId);
  const linkedFromIds = new Set<string>();
  for (const other of scope.seasonIds ?? []) {
    if (other === seasonId) continue;
    for (const p of await readScopedRoster(db, other)) {
      for (const r of normalizeLinkedFrom(p.data.linkedFrom)) if (r.seasonId === seasonId) linkedFromIds.add(r.seasonPlayerId);
    }
  }
  const blocker = rosterRemovalBlocker(seasonPlayerId, { ...scan, linkedFromIds });
  if (blocker) throw new Error(`${name} ${blocker}, so they stay on the roster.`);
  const batch = writeBatch(db);
  batch.delete(doc(ref, "private", "profile"));
  batch.delete(ref);
  await batch.commit();
}

/**
 * Prior rosters for the returning-player picker, in Tallies mode: the
 * selected team's seasons only, with identity fields from private profiles.
 */
export async function loadScopedRosterSeasons(db: Firestore, seasons: SeasonSummary[]) {
  return Promise.all(
    seasons.map(async (s) => ({
      ...s,
      players: (await readScopedRoster(db, s.seasonId)).map(({ id, data }) => ({
        id,
        name: typeof data.name === "string" ? data.name : "",
        number: typeof data.number === "number" ? data.number : 0,
        careerPlayerId: typeof data.careerPlayerId === "string" ? data.careerPlayerId : undefined,
        identityStatus: data.identityStatus,
        linkedFrom: normalizeLinkedFrom(data.linkedFrom),
      })),
    })),
  );
}
