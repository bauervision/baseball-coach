// The coach's data scope in Tallies mode: one authoritative answer to "whose
// data, which team" for every Admin read and write.
//
//   null                      legacy single-team app (firestore.rules shapes)
//   { team: null }            approved coach, no team selected (onboarding)
//   { team: {...} }           one team the coach owns, verified by reading it
//                             (rules deny another coach's team), with the
//                             ids of that team's seasons
//
// Hooks read it with useAdminScope() and pass it to the data functions,
// which write the multi-coach shapes (ownerUid, private profiles, audit in
// private/audit, team current season) and refuse seasons of another team.
// The URL only *selects* a team; access is always decided by the rules.

import * as React from "react";

import type { Team } from "@/lib/branding";

export type ScopedTeam = Team & {
  workspaceId: string;
  currentSeasonId: string | null;
};

export type AdminDataScope = {
  uid: string;
  workspaceId: string;
  team: ScopedTeam | null;
  /** Ids of the selected team's seasons (null while no team is selected). */
  seasonIds: ReadonlySet<string> | null;
  /** Re-reads the team and its seasons (after make-current, publish, …). */
  refresh: () => void;
};

export const AdminScopeContext = React.createContext<AdminDataScope | null>(null);

export function useAdminScope(): AdminDataScope | null {
  return React.useContext(AdminScopeContext);
}

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

/** The selected team, or a clear error (never another team). */
export function requireTeam(scope: AdminDataScope): ScopedTeam {
  if (!scope.team) throw new ScopeError("Choose a team first.");
  return scope.team;
}

/**
 * Season data from Firestore must belong to the selected team and coach.
 * Called on the freshly read season doc inside each scoped write, so a
 * stale screen or a hand-edited URL can never write into another team.
 */
export function assertSeasonInTeam(
  scope: AdminDataScope,
  seasonId: string,
  data: Record<string, unknown> | undefined | null,
): void {
  const team = requireTeam(scope);
  if (!data || data.teamId !== team.teamId || data.ownerUid !== scope.uid) {
    throw new ScopeError(`Season "${seasonId}" isn't part of ${team.teamName}.`);
  }
}

/** Admin URL for the selected team (keeps the team on every navigation). */
export function adminHref(scope: AdminDataScope | null, extra = ""): string {
  if (!scope?.team) return `/admin/${extra ? `?${extra}` : ""}`;
  const q = `team=${encodeURIComponent(scope.team.teamId)}`;
  return `/admin/?${q}${extra ? `&${extra}` : ""}`;
}
