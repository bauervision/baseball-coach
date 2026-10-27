"use client";

// A coach's selected team in the Tallies workspace (/admin/?team={teamId}).
//
// TeamAdminScope is the single authority for the team context: it reads
// the team (rules: owner only — another coach's id reads nothing and shows
// "Team not found"), the ids of its seasons, and provides AdminDataScope to
// everything below. The workspace is keyed by team id, so switching teams
// remounts it: no state, cache, or pending result of one team survives
// into the other (writes already in flight keep their own team's ids).

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";

import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AdminScopeContext, type AdminDataScope, type ScopedTeam } from "@/lib/adminScope";
import { getFirestoreDb } from "@/lib/firebase.client";
import { readScopedTeam } from "@/lib/teamData";
import { snapshotFromTeam } from "@/lib/branding";
import { setupHref } from "@/lib/seasonSetup";
import { CoachShellBrandingContext } from "@/components/tallies/TalliesFrames";
import { TeamManager } from "@/components/auth/TeamManager";
import AdminClient from "@/app/(protected)/admin/AdminClient";
import PlayerPageClient from "@/app/player/PlayerPageClient";
import { StandaloneSetup } from "@/app/(protected)/admin/_parts/TeamWithoutSeason";

export function TeamAdminScope(props: {
  uid: string;
  workspaceId: string;
  teamId: string;
  children: React.ReactNode;
}) {
  const { uid, workspaceId, teamId } = props;
  const db = React.useMemo(() => getFirestoreDb(), []);
  const [state, setState] = React.useState<{ team: ScopedTeam | null; ids: ReadonlySet<string> } | undefined>(undefined);
  const [version, setVersion] = React.useState(0);
  const setShellBranding = React.useContext(CoachShellBrandingContext);

  React.useEffect(() => {
    let active = true;
    (async () => {
      const team = await readScopedTeam(db, teamId);
      let ids: ReadonlySet<string> = new Set();
      if (team) {
        const snap = await getDocs(
          query(collection(db, "seasons"), where("ownerUid", "==", uid), where("teamId", "==", teamId)),
        ).catch(() => null);
        ids = new Set(snap?.docs.map((d) => d.id) ?? []);
      }
      if (active) setState({ team, ids });
    })();
    return () => {
      active = false;
    };
  }, [db, uid, teamId, version]);

  const brandingKey = state?.team ? JSON.stringify([state.team.palettes, state.team.logo]) : "";
  React.useEffect(() => {
    // The team's own colors and logo inside its workspace; Tallies outside.
    setShellBranding(state?.team ? snapshotFromTeam(state.team) : null);
    return () => setShellBranding(null);
    // brandingKey captures what the document shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandingKey, setShellBranding]);

  const refresh = React.useCallback(() => setVersion((v) => v + 1), []);
  const scope = React.useMemo<AdminDataScope | null>(
    () => (state?.team ? { uid, workspaceId, team: state.team, seasonIds: state.ids, refresh } : null),
    [state, uid, workspaceId, refresh],
  );

  if (state === undefined) {
    return (
      <div role="status" className="text-sm" style={{ color: "var(--muted)" }}>
        Loading team…
      </div>
    );
  }
  if (!scope) {
    return (
      <Card data-team-manager="notFound">
        <CardHeader>
          <CardTitle>Team not found</CardTitle>
          <CardSubtitle>This team isn&rsquo;t in your workspace.</CardSubtitle>
        </CardHeader>
        <CardContent>
          <Link href="/admin/" className="text-sm font-semibold underline underline-offset-4">
            Back to your teams
          </Link>
        </CardContent>
      </Card>
    );
  }
  return <AdminScopeContext.Provider value={scope}>{props.children}</AdminScopeContext.Provider>;
}

/** Onboarding scope: an approved coach with no team selected. */
export function OnboardingScope(props: { uid: string; workspaceId: string; children: React.ReactNode }) {
  const scope = React.useMemo<AdminDataScope>(
    () => ({ uid: props.uid, workspaceId: props.workspaceId, team: null, seasonIds: null, refresh: () => undefined }),
    [props.uid, props.workspaceId],
  );
  return <AdminScopeContext.Provider value={scope}>{props.children}</AdminScopeContext.Provider>;
}

export function FirstTeamSetup() {
  return (
    <div className="grid gap-3" data-onboarding>
      <StandaloneSetup />
    </div>
  );
}

/** Inside a selected team: switcher, parents & publishing, then the Admin. */
export function TeamWorkspace(props: { teams: Array<{ teamId: string; teamName: string }> | null }) {
  const scope = React.useContext(AdminScopeContext)!;
  const team = scope.team!;
  const router = useRouter();
  const sp = useSearchParams();
  const playerId = sp.get("id");
  const setup = sp.get("setup") === "1";
  const [showParents, setShowParents] = React.useState(false);

  return (
    <div className="grid gap-4" data-team-workspace={team.teamId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label htmlFor="team-switch" className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
            Team
          </label>
          <select
            id="team-switch"
            value={team.teamId}
            onChange={(e) => router.push(`/admin/?team=${encodeURIComponent(e.target.value)}`)}
            className="h-9 max-w-[16rem] rounded-xl border px-2 text-sm font-semibold"
            style={{
              borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
              background: "color-mix(in oklab, var(--bg-base) 70%, transparent)",
              color: "var(--foreground)",
            }}
          >
            {(props.teams?.some((t) => t.teamId === team.teamId) ? props.teams : [...(props.teams ?? []), team]).map((t) => (
              <option key={t.teamId} value={t.teamId} style={{ color: "#000" }}>
                {t.teamName}
              </option>
            ))}
          </select>
          <Link href="/admin/" className="text-xs font-semibold underline underline-offset-4" style={{ color: "var(--muted)" }}>
            All teams
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {playerId ? (
            <Button size="sm" variant="secondary" onClick={() => router.push(`/admin/?team=${encodeURIComponent(team.teamId)}`)}>
              Back to Admin
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" aria-expanded={showParents} onClick={() => setShowParents((v) => !v)} data-parents-toggle>
            {showParents ? "Hide parent link & publishing" : "Parent link & publishing"}
          </Button>
        </div>
      </div>

      {showParents ? <TeamManager uid={scope.uid} teamId={team.teamId} embedded onChangedAction={scope.refresh} /> : null}

      {playerId && !setup ? (
        <React.Suspense fallback={null}>
          <PlayerPageClient />
        </React.Suspense>
      ) : (
        <AdminClient />
      )}
    </div>
  );
}

export function NewTeamButton() {
  const router = useRouter();
  return (
    <Button variant="secondary" onClick={() => router.push(setupHref({ step: "team" }))} data-new-team>
      Set up a new team
    </Button>
  );
}
