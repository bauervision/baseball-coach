// Firestore persistence for team identities (teams/{teamId}) and the
// explicit "apply team branding to a season" action. Team edits never
// touch seasons: each season keeps its own branding snapshot until the
// coach explicitly applies newer branding to an open season. Rules allow
// only the head coach (admin) to read or write teams.

import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";

import {
  isSupportedSport,
  isValidLogoRef,
  isValidPalette,
  snapshotFromTeam,
  validateBranding,
  type LogoRef,
  type Team,
} from "@/lib/branding";
import { isFinalized } from "@/lib/seasonLifecycle";

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

export async function listTeams(db: Firestore): Promise<Team[]> {
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

/** Saves a team's identity and both palettes together. */
export async function updateTeam(db: Firestore, team: Team): Promise<void> {
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
