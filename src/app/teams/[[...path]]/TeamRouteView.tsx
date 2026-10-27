"use client";

// Every /teams/** URL renders this one prerendered shell (static export +
// Hosting rewrite). The team scope (src/lib/teamScope.tsx) has already
// parsed the path and verified the season; this view shows the existing
// parent pages for it, or a clear state. Never a fallback season.

import * as React from "react";
import Link from "next/link";

import HomeClient from "@/app/HomeClient";
import TrophiesClient from "@/app/trophies/TrophiesClient";
import PlayerPageClient from "@/app/player/PlayerPageClient";
import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/Card";
import { useSeasonList } from "@/components/season/SeasonSelector";
import { useRosterPlayers } from "@/lib/rosterStore";
import { useSeasonLinks } from "@/lib/seasonLinks";
import { useAppMode, useTeamScope } from "@/lib/teamScope";

function useHeadingFocus(key: string) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    // Move focus only for state pages (not on the first paint of content).
    ref.current?.focus({ preventScroll: true });
  }, [key]);
  return ref;
}

function RouteState(props: { state: string; title: string; body: string; children?: React.ReactNode }) {
  const ref = useHeadingFocus(props.state);
  return (
    <Card data-team-route-state={props.state}>
      <CardHeader>
        <CardTitle>
          <span ref={ref} tabIndex={-1} className="outline-none">
            {props.title}
          </span>
        </CardTitle>
        <CardSubtitle>{props.body}</CardSubtitle>
      </CardHeader>
      {props.children ? <CardContent>{props.children}</CardContent> : null}
    </Card>
  );
}

function PublishedSeasonList() {
  const list = useSeasonList();
  const links = useSeasonLinks();
  if (list === null) {
    return (
      <div className="text-sm" style={{ color: "var(--muted)" }}>
        Loading seasons…
      </div>
    );
  }
  if (list.length === 0) return null;
  return (
    <nav aria-label="Past seasons">
      <div className="mb-2 text-sm font-semibold">Past seasons</div>
      <ul className="grid gap-1.5">
        {list.map((s) => (
          <li key={s.seasonId}>
            <Link className="text-sm font-semibold underline underline-offset-4" href={links.home(s.seasonId)}>
              {s.seasonLabel} — {s.teamName}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function TeamRouteView() {
  const mode = useAppMode();
  const scope = useTeamScope();
  const { loaded, players } = useRosterPlayers(null);

  React.useEffect(() => {
    if (!scope.inTeam) return;
    const name = scope.team?.teamName;
    document.title = name ? `${name} · Tallies` : "Tallies";
  }, [scope]);

  if (mode === null) return null;
  if (mode === "legacy" || !scope.inTeam) {
    return <RouteState state="notFound" title="Page not found" body="That page doesn't exist." />;
  }

  if (scope.status === "loading" || (scope.status === "ready" && (!loaded || players === null))) {
    return (
      <div role="status" aria-live="polite" className="text-sm" style={{ color: "var(--muted)" }} data-team-route-state="loading">
        Loading team page…
      </div>
    );
  }

  if (scope.status === "notFound") {
    return (
      <RouteState
        state="notFound"
        title="Team page not found"
        body="This link doesn't match a published team page. Check the link your coach shared."
      />
    );
  }

  if (scope.status === "noSeason") {
    return (
      <RouteState
        state="noSeason"
        title={scope.team?.teamName ? `${scope.team.teamName}` : "No season yet"}
        body="There's no published current season yet. Check back soon."
      >
        <PublishedSeasonList />
      </RouteState>
    );
  }

  const view = scope.route?.view ?? "home";
  if (view === "trophies") return <TrophiesClient />;
  if (view === "player") {
    return (
      <React.Suspense fallback={null}>
        <PlayerPageClient />
      </React.Suspense>
    );
  }
  return <HomeClient />;
}
