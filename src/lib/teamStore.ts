// Firestore persistence for team identities (teams/{teamId}) and the
// explicit "apply team branding to a season" action. Team edits never
// touch seasons: each season keeps its own branding snapshot until the
// coach explicitly applies newer branding to an open season. Rules allow
// only the head coach (admin) to read or write teams.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";

import {
  isSupportedSport,
  isValidLogoRef,
  isValidPalette,
  sameBranding,
  snapshotFromTeam,
  validateBranding,
  type LogoRef,
  type Team,
} from "@/lib/branding";
import { isFinalized } from "@/lib/seasonLifecycle";
import type { AdminDataScope } from "@/lib/adminScope";
import { createScopedTeam, listScopedTeams, readScopedTeam, updateScopedTeam } from "@/lib/teamData";

/**
 * User-facing text for a failed team read or write. A permission denial
 * gets an actionable explanation (most often: the database's deployed
 * security rules predate teams) instead of the SDK's generic message.
 */
export function teamAccessMessage(e: unknown, fallback: string): string {
  const code = e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code) : "";
  if (code === "permission-denied" || code === "firestore/permission-denied") {
    return "Teams are not available: this database's security rules do not allow this account to read or save teams. Ask the project owner to deploy the current Firestore rules.";
  }
  return e && typeof e === "object" && "message" in e
    ? String((e as { message?: unknown }).message)
    : fallback;
}

function teamFromData(id: string, d: Record<string, unknown>): Team | null {
  const palettes = d.palettes as Team["palettes"] | undefined;
  if (
    !isSupportedSport(d.sport) ||
    !isValidLogoRef(d.logo ?? null) ||
    !isValidPalette(palettes?.dark) ||
    !isValidPalette(palettes?.light)
  ) {
    return null;
  }
  return {
    teamId: id,
    teamName: String(d.teamName ?? ""),
    shortName: String(d.shortName ?? ""),
    sport: d.sport,
    division: String(d.division ?? ""),
    logo: (d.logo ?? null) as LogoRef,
    palettes: { dark: { ...palettes!.dark }, light: { ...palettes!.light } },
    awardCollection: String(d.awardCollection ?? "original"),
  };
}

/** All teams (legacy), or in Tallies mode the selected team / the coach's own. */
export async function listTeams(db: Firestore, scope?: AdminDataScope | null): Promise<Team[]> {
  if (scope) {
    if (!scope.team) return listScopedTeams(db, scope.uid);
    const fresh = await readScopedTeam(db, scope.team.teamId);
    return fresh ? [fresh] : [];
  }
  const snap = await getDocs(collection(db, "teams"));
  return snap.docs
    .map((d) => teamFromData(d.id, d.data()))
    .filter((t): t is Team => t !== null)
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
}

function teamFields(team: Team) {
  const s = snapshotFromTeam(team);
  return {
    teamId: team.teamId,
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
  const errors = validateBranding(team);
  const first = Object.values(errors)[0];
  if (first) throw new Error(first);
}

/** Creates a team. Refuses an id that already exists. */
export async function createTeam(db: Firestore, team: Team): Promise<void> {
  assertValid(team);
  const ref = doc(db, "teams", team.teamId);
  await runTransaction(db, async (tx) => {
    if ((await tx.get(ref)).exists()) {
      throw new Error("A team with this id already exists.");
    }
    tx.set(ref, { ...teamFields(team), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
}

/**
 * Creates a team, safely retryable: if the id already exists and holds
 * exactly this team (e.g. an earlier attempt succeeded but its response was
 * lost), it is recovered instead of duplicated. A different team on the
 * same id is refused.
 */
export async function createTeamIdempotent(
  db: Firestore,
  team: Team,
  scope?: AdminDataScope | null,
): Promise<"created" | "recovered"> {
  if (scope) return createScopedTeam(db, scope, team);
  try {
    await createTeam(db, team);
    return "created";
  } catch (e: unknown) {
    if (!/already exists/.test(e instanceof Error ? e.message : String(e))) throw e;
    const snap = await getDoc(doc(db, "teams", team.teamId));
    const existing = snap.exists() ? teamFromData(snap.id, snap.data()) : null;
    if (existing && sameBranding(snapshotFromTeam(existing), snapshotFromTeam(team))) {
      return "recovered";
    }
    throw new Error("A different team already uses this id.");
  }
}

/** Saves a team's identity and both palettes together. */
export async function updateTeam(db: Firestore, team: Team, scope?: AdminDataScope | null): Promise<void> {
  if (scope) return updateScopedTeam(db, scope, team);
  assertValid(team);
  const ref = doc(db, "teams", team.teamId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("This team no longer exists.");
    tx.update(ref, { ...teamFields(team), updatedAt: serverTimestamp() });
  });
}

/**
 * Explicitly replaces an open season's branding snapshot with the team's
 * current branding (and links the season to the team). Finalized seasons
 * are refused here and by the rules.
 */
export async function applyTeamBrandingToSeason(opts: {
  db: Firestore;
  seasonId: string;
  team: Team;
}): Promise<void> {
  const { db, seasonId, team } = opts;
  assertValid(team);
  const ref = doc(db, "seasons", seasonId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`Season "${seasonId}" does not exist.`);
    if (isFinalized(snap.data())) {
      throw new Error("This season is finalized; its branding is preserved as it was.");
    }
    tx.update(ref, {
      teamId: team.teamId,
      teamName: team.teamName.trim(),
      league: team.division.trim(),
      branding: snapshotFromTeam(team),
      updatedAt: serverTimestamp(),
    });
  });
}
