"use client";

// Parent-facing links for the current page's mode: legacy query routes
// (/?season=, /player?id=&season=, /trophies?season=) or permanent team
// routes (/teams/{teamId}/…) in Tallies mode. Pages never build either
// shape by hand, so a team page can never link back into the legacy
// single-team views (or the Tigers).

import * as React from "react";

import { withSeason } from "@/lib/seasonHref";
import { useTeamScope } from "@/lib/teamScopeContext";
import { seasonHomeHref, seasonPlayerHref, seasonTrophiesHref, teamHref } from "@/lib/teamRoutes";

export type SeasonLinks = {
  /** Team route: parents' read-only view, no coach controls. */
  publicView: boolean;
  /** seasonId null = the current season. */
  home(seasonId: string | null, activeSeasonId?: string | null, teamId?: string): string;
  trophies(seasonId: string | null): string;
  player(seasonId: string | null, playerId: string, activeSeasonId?: string | null, teamId?: string): string;
};

export function useSeasonLinks(): SeasonLinks {
  const scope = useTeamScope();
  const team = scope.inTeam ? scope.teamId : null;
  const current = scope.inTeam ? scope.currentSeasonId : null;
  const shown = scope.inTeam ? scope.seasonId : null;

  return React.useMemo<SeasonLinks>(() => {
    if (team) {
      return {
        publicView: true,
        home: (sid, _active, teamId) => {
          const t = teamId ?? team;
          if (t !== team) return sid ? seasonHomeHref(t, sid) : teamHref(t);
          return !sid || sid === current ? teamHref(t) : seasonHomeHref(t, sid);
        },
        trophies: (sid) => {
          const s = sid ?? current ?? shown;
          return s ? seasonTrophiesHref(team, s) : teamHref(team);
        },
        player: (sid, pid, _active, teamId) => {
          const s = sid ?? shown;
          return s ? seasonPlayerHref(teamId ?? team, s, pid) : teamHref(team);
        },
      };
    }
    return {
      publicView: false,
      home: (sid, active) => withSeason("/", sid, active),
      trophies: (sid) => withSeason("/trophies", sid),
      player: (sid, pid, active) => withSeason(`/player?id=${encodeURIComponent(pid)}`, sid, active),
    };
  }, [team, current, shown]);
}
