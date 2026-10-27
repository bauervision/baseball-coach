"use client";

// Tallies coach area without a current season: a brand-new workspace
// (onboarding, no team yet) or a team whose first season isn't active yet.
// Only setup and the Team Designer run here — nothing that needs a season,
// and never a fallback season.

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { getFirestoreDb } from "@/lib/firebase.client";
import { adminHref, useAdminScope } from "@/lib/adminScope";
import { listTeams } from "@/lib/teamStore";
import { listScopedSeasons } from "@/lib/teamData";
import { setupHref } from "@/lib/seasonSetup";
import type { Team } from "@/lib/branding";
import type { SeasonSummary } from "@/lib/seasonStore";
import { SeasonSetupWizard } from "./SeasonSetupWizard";
import { DISCARD_TEAM_PROMPT, TeamDesignerTab } from "./TeamDesignerTab";

/** New Season Setup with its own data (no current-season Admin around it). */
export function StandaloneSetup() {
  const scope = useAdminScope();
  const router = useRouter();
  const db = React.useMemo(() => getFirestoreDb(), []);
  const [teams, setTeams] = React.useState<Team[] | null>(null);
  const [teamsError, setTeamsError] = React.useState<string | null>(null);
  const [seasons, setSeasons] = React.useState<SeasonSummary[] | null>(null);
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    if (!scope) return;
    let active = true;
    Promise.all([listTeams(db, scope), listScopedSeasons(db, scope)])
      .then(([t, s]) => {
        if (!active) return;
        setTeams(t);
        setSeasons(s);
        setTeamsError(null);
      })
      .catch(() => {
        if (!active) return;
        setTeams([]);
        setSeasons([]);
        setTeamsError("Your teams couldn't be loaded. Please try again.");
      });
    return () => {
      active = false;
    };
  }, [db, scope, version]);

  if (!scope) return null;
  const refresh = () => {
    setVersion((v) => v + 1);
    scope.refresh();
  };
  return (
    <SeasonSetupWizard
      db={db}
      uid={scope.uid}
      canEdit
      teams={teams}
      teamsError={teamsError}
      seasons={seasons}
      currentSeasonId={scope.team?.currentSeasonId ?? ""}
      onTeamsChangedAction={refresh}
      onSeasonsChangedAction={refresh}
      onDirtyChangeAction={() => undefined}
      onExitAction={() => router.push(adminHref(scope))}
      onOpenLineupAction={() => router.push(adminHref(scope, "tab=lineup"))}
    />
  );
}

/** A team whose first season isn't current yet: setup, or edit the team. */
export function TeamWithoutSeason() {
  const scope = useAdminScope();
  const router = useRouter();
  const sp = useSearchParams();
  const db = React.useMemo(() => getFirestoreDb(), []);
  const [designing, setDesigning] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  if (!scope?.team) return null;
  if (sp.get("setup") === "1") return <StandaloneSetup />;
  const team = scope.team;
  return (
    <div className="grid gap-4" data-team-without-season>
      <Card>
        <CardHeader>
          <CardTitle>No current season yet</CardTitle>
          <CardSubtitle>
            Set up {team.teamName}&rsquo;s first season: pick the season, add the roster, then make it current. Stats,
            lineups, and awards open once a season is current.
          </CardSubtitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => router.push(setupHref({ step: "season", team: team.teamId }))} data-start-setup>
            Start New Season Setup
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (designing && dirty && !window.confirm(DISCARD_TEAM_PROMPT)) return;
              setDesigning((d) => !d);
            }}
          >
            {designing ? "Close Team Designer" : "Edit team identity"}
          </Button>
        </CardContent>
      </Card>
      {designing ? (
        <TeamDesignerTab
          db={db}
          canEdit
          teams={[team]}
          seasons={[]}
          onTeamsChangedAction={() => scope.refresh()}
          onSeasonsChangedAction={() => undefined}
          onDirtyChangeAction={setDirty}
        />
      ) : null}
    </div>
  );
}
