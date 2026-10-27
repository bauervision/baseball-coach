"use client";

// App mode and team-route scope.
//
// Mode is decided once after mount (static HTML is identical either way):
// "tallies" = multi-coach build (public landing, permanent team routes,
// Google-first coach sign-in); "legacy" = the single-team Baseball Coach app.
//
// On /teams/** in Tallies mode, the scope names the team and the season the
// page shows. The season comes from the path, or for the permanent link from
// publicTeams/{teamId}.currentSeasonId (the coach's published current
// season). It is verified to be a published season of that team before any
// page renders. Nothing here ever falls back to app/config or the Tigers:
// unresolved routes are "loading", "notFound", or "noSeason".

import * as React from "react";
import { usePathname } from "next/navigation";
import { doc, getDoc, onSnapshot } from "firebase/firestore";

import { getFirestoreDb } from "@/lib/firebase.client";
import { multiCoachEnabled } from "@/lib/features";
import { normalizeBranding } from "@/lib/branding";
import { parseTeamPath } from "@/lib/teamRoutes";
import { ScopeContext, type AppMode, type Ctx, type PublicTeam } from "@/lib/teamScopeContext";

export { useAppMode, useTeamScope, type AppMode, type PublicTeam, type TeamScope } from "@/lib/teamScopeContext";

type Resolved = {
  key: string;
  status: "ready" | "notFound" | "noSeason";
  team: PublicTeam | null;
  seasonId: string | null;
};

function publicTeamFrom(teamId: string, data: Record<string, unknown>): PublicTeam {
  const branding = normalizeBranding({ ...data, teamId });
  return {
    teamId,
    branding,
    teamName: typeof data.teamName === "string" ? data.teamName : "",
    currentSeasonId:
      typeof data.currentSeasonId === "string" && data.currentSeasonId ? data.currentSeasonId : null,
  };
}

export function TeamScopeProvider(props: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [mode, setMode] = React.useState<AppMode | null>(null);
  React.useEffect(() => setMode(multiCoachEnabled() ? "tallies" : "legacy"), []);

  const parsed = React.useMemo(() => parseTeamPath(pathname), [pathname]);
  const route = parsed && parsed !== "invalid" ? parsed : null;
  const teamId = route?.teamId ?? "";
  const explicitSeason = route?.seasonId ?? null;
  const key = parsed === "invalid" ? "invalid" : `${teamId}|${explicitSeason ?? ""}`;
  const active = mode === "tallies" && parsed !== null;

  const [resolved, setResolved] = React.useState<Resolved | null>(null);

  React.useEffect(() => {
    if (!active || !route) return;
    const db = getFirestoreDb();
    let alive = true;
    let seq = 0;
    const done = (r: Omit<Resolved, "key">) => {
      if (alive) setResolved({ key, ...r });
    };
    const unsub = onSnapshot(
      doc(db, "publicTeams", teamId),
      async (snap) => {
        const mine = ++seq;
        if (!snap.exists()) return done({ status: "notFound", team: null, seasonId: null });
        const team = publicTeamFrom(teamId, snap.data());
        const target = explicitSeason ?? team.currentSeasonId;
        if (!target) return done({ status: "noSeason", team, seasonId: null });
        let ok = false;
        try {
          const s = await getDoc(doc(db, "seasons", target));
          ok = s.exists() && s.data().published === true && s.data().teamId === teamId;
        } catch {
          ok = false; // unpublished or missing: rules deny the read
        }
        if (mine !== seq) return;
        if (ok) done({ status: "ready", team, seasonId: target });
        else done({ status: explicitSeason ? "notFound" : "noSeason", team, seasonId: null });
      },
      () => done({ status: "notFound", team: null, seasonId: null }),
    );
    return () => {
      alive = false;
      unsub();
    };
    // `route` is derived from `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);

  const value = React.useMemo<Ctx>(() => {
    if (!active) return { mode, scope: { inTeam: false } };
    if (!route) {
      return {
        mode,
        scope: { inTeam: true, status: "notFound", route: null, teamId: "", team: null, seasonId: null, currentSeasonId: null },
      };
    }
    const r = resolved?.key === key ? resolved : null;
    return {
      mode,
      scope: {
        inTeam: true,
        status: r?.status ?? "loading",
        route,
        teamId,
        team: r?.team ?? null,
        seasonId: r?.status === "ready" ? r.seasonId : null,
        currentSeasonId: r?.team?.currentSeasonId ?? null,
      },
    };
  }, [active, mode, route, resolved, key, teamId]);

  return <ScopeContext.Provider value={value}>{props.children}</ScopeContext.Provider>;
}
