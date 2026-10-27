"use client";

// The *viewed* season is a viewer preference carried in the URL
// (?season=<seasonId>), so historical pages can be bookmarked, shared,
// refreshed, and navigated with back/forward. It never writes
// app/config.currentSeasonId, which stays the coach's administrative
// (active) season. No ?season= means "show the active season".

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useTeamScope } from "@/lib/teamScopeContext";

const ViewedSeasonContext = React.createContext<string | null>(null);

function FromSearchParams(props: { children: React.ReactNode }) {
  const sp = useSearchParams();
  const season = sp.get("season")?.trim() || null;
  return (
    <ViewedSeasonContext.Provider value={season}>
      {props.children}
    </ViewedSeasonContext.Provider>
  );
}

export function ViewedSeasonProvider(props: { children: React.ReactNode }) {
  // useSearchParams needs a Suspense boundary in a static export. The
  // fallback renders the same tree for the active season until the URL is
  // read on the client.
  return (
    <React.Suspense
      fallback={
        <ViewedSeasonContext.Provider value={null}>
          {props.children}
        </ViewedSeasonContext.Provider>
      }
    >
      <FromSearchParams>{props.children}</FromSearchParams>
    </React.Suspense>
  );
}

/**
 * The season id from the URL, or null for "the active season". On a team
 * route it is the route's resolved season (null until resolved; data hooks
 * read the team scope themselves and never fall back to app/config there).
 */
export function useViewedSeasonId(): string | null {
  const fromQuery = React.useContext(ViewedSeasonContext);
  const scope = useTeamScope();
  return scope.inTeam ? scope.seasonId : fromQuery;
}

export { withSeason } from "@/lib/seasonHref";
