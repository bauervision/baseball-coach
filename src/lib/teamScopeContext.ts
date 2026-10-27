// App mode and team-route scope: context and hooks (no JSX, so plain .ts
// modules such as the roster store can read it). The provider that fills it
// is TeamScopeProvider in teamScope.tsx.

import * as React from "react";

import type { SeasonBranding } from "@/lib/branding";
import type { TeamRoute } from "@/lib/teamRoutes";

export type AppMode = "legacy" | "tallies";

export type PublicTeam = {
  teamId: string;
  branding: SeasonBranding | null;
  teamName: string;
  /** Published current season, or null (none chosen, or not published). */
  currentSeasonId: string | null;
};

export type TeamScope =
  | { inTeam: false }
  | {
      inTeam: true;
      status: "loading" | "ready" | "notFound" | "noSeason";
      route: TeamRoute | null;
      teamId: string;
      team: PublicTeam | null;
      /** The season shown (verified published, of this team) when ready. */
      seasonId: string | null;
      currentSeasonId: string | null;
    };

export type Ctx = { mode: AppMode | null; scope: TeamScope };

export const ScopeContext = React.createContext<Ctx>({ mode: null, scope: { inTeam: false } });

export function useAppMode(): AppMode | null {
  return React.useContext(ScopeContext).mode;
}

export function useTeamScope(): TeamScope {
  return React.useContext(ScopeContext).scope;
}

