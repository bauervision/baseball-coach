"use client";

// Multi-coach mode Admin entry: decides access from Firebase Auth + Firestore
// (coaches/{uid}, invitations) before showing anything private. Approved
// coaches land in their workspace (their own teams; ?team= opens one);
// everyone else sees "Access not enabled". Full season management on the
// multi-coach data model (stats, roster, setup) is the next checkpoint.

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";

import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase.client";
import { clearSession, readSession } from "@/lib/session";
import { hasGoogle, resolveCoachAccess, type CoachAccess } from "@/lib/coachAccess";
import { listOwnedTeams, type OwnedTeam } from "@/lib/teamPublication";
import { LinkGoogleCard } from "@/components/auth/LinkGoogleCard";
import { FirstTeamSetup, NewTeamButton, OnboardingScope, TeamAdminScope, TeamWorkspace } from "@/components/auth/TeamWorkspace";

type GateState =
  | { kind: "loading" }
  | { kind: "signedOut"; sessionEnded: boolean }
  | { kind: "checking" }
  | { kind: "approved"; user: User; access: Extract<CoachAccess, { state: "approved" }> }
  | { kind: "notApproved" }
  | { kind: "error"; message: string };

function useFocusOnChange(key: string) {
  const ref = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    ref.current?.focus();
  }, [key]);
  return ref;
}

export function CoachWorkspaceGate() {
  const router = useRouter();
  const auth = React.useMemo(() => getFirebaseAuth(), []);
  const db = React.useMemo(() => getFirestoreDb(), []);
  const [state, setState] = React.useState<GateState>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        setState({ kind: "signedOut", sessionEnded: readSession() !== null });
        return;
      }
      setState({ kind: "checking" });
      try {
        const access = await resolveCoachAccess(db, user);
        if (!active) return;
        setState(access.state === "approved" ? { kind: "approved", user, access } : { kind: "notApproved" });
      } catch {
        if (active) setState({ kind: "error", message: "We couldn't check your access. Please try again." });
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, [auth, db, attempt]);

  const onSignOut = React.useCallback(async () => {
    await signOut(auth).catch(() => {});
    clearSession();
  }, [auth]);

  const headingRef = useFocusOnChange(state.kind);

  if (state.kind === "loading" || state.kind === "checking") {
    return (
      <Card aria-busy="true">
        <CardContent>
          <div className="text-sm" role="status" style={{ color: "var(--muted)" }}>
            {state.kind === "loading" ? "Checking sign-in…" : "Checking access…"}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === "approved") {
    return <CoachWorkspaceHome user={state.user} workspaceId={state.access.workspaceId} onSignOutAction={onSignOut} />;
  }

  const panel = {
    signedOut: {
      title: state.kind === "signedOut" && state.sessionEnded ? "Your session has ended" : "Sign in to continue",
      body: "Sign in again with your coach account.",
      action: (
        <Button
          onClick={() => {
            clearSession();
            router.push("/signin/");
          }}
        >
          Sign in
        </Button>
      ),
    },
    notApproved: {
      title: "Access not enabled",
      body: "This account doesn't have coach access. If you think it should, ask the person who invited you.",
      action: (
        <Button variant="secondary" onClick={() => void onSignOut()}>
          Sign out
        </Button>
      ),
    },
    error: {
      title: "Something went wrong",
      body: state.kind === "error" ? state.message : "",
      action: (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          <Button variant="ghost" onClick={() => void onSignOut()}>
            Sign out
          </Button>
        </div>
      ),
    },
  }[state.kind];

  return (
    <Card data-coach-gate={state.kind}>
      <CardHeader>
        <CardTitle>
          <span ref={headingRef} tabIndex={-1} className="outline-none">
            {panel.title}
          </span>
        </CardTitle>
        <CardSubtitle>{panel.body}</CardSubtitle>
      </CardHeader>
      <CardContent>{panel.action}</CardContent>
    </Card>
  );
}

function CoachWorkspaceHome(props: {
  user: User;
  workspaceId: string;
  onSignOutAction: () => Promise<void>;
}) {
  const db = React.useMemo(() => getFirestoreDb(), []);
  const auth = React.useMemo(() => getFirebaseAuth(), []);
  const router = useRouter();
  const sp = useSearchParams();
  const selectedTeam = sp.get("team")?.trim() || null;
  const onboarding = !selectedTeam && sp.get("setup") === "1";
  const headingRef = useFocusOnChange(selectedTeam ? "team" : "approved");
  const [teams, setTeams] = React.useState<OwnedTeam[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  // The original coach signs in with a password until Google is linked.
  const passwordOnly = !hasGoogle(props.user);

  React.useEffect(() => {
    let active = true;
    // Scoped query: rules only allow the coach's own teams.
    listOwnedTeams(db, props.user.uid)
      .then((list) => {
        if (active) setTeams(list);
      })
      .catch(() => {
        if (active) setErr("Your teams couldn't be loaded.");
      });
    return () => {
      active = false;
    };
  }, [db, props.user.uid]);

  return (
    <div className="grid gap-4" data-coach-gate="approved" data-workspace-id={props.workspaceId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold">
            <span ref={selectedTeam ? undefined : headingRef} tabIndex={-1} className="outline-none">
              Your workspace
            </span>
          </h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Signed in as {props.user.email ?? "coach"}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void props.onSignOutAction()}>
          Sign out
        </Button>
      </div>

      {passwordOnly ? <LinkGoogleCard auth={auth} /> : null}

      {selectedTeam ? (
        <TeamAdminScope key={selectedTeam} uid={props.user.uid} workspaceId={props.workspaceId} teamId={selectedTeam}>
          <TeamWorkspace teams={teams} />
        </TeamAdminScope>
      ) : onboarding ? (
        <OnboardingScope uid={props.user.uid} workspaceId={props.workspaceId}>
          <FirstTeamSetup />
        </OnboardingScope>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Your teams</CardTitle>
            <CardSubtitle>Choose a team to manage its seasons and parent link.</CardSubtitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {err ? (
              <div role="alert" className="text-sm">{err}</div>
            ) : teams === null ? (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Loading teams…
              </div>
            ) : teams.length === 0 ? (
              <div className="grid gap-3" data-empty-workspace>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  No teams yet. Set up your first team: its name, sport, colors, and first season.
                </p>
                <div>
                  <Button onClick={() => router.push("/admin/?setup=1&step=team")} data-first-team>
                    Set up your first team
                  </Button>
                </div>
              </div>
            ) : (
              <ul aria-label="Your teams" className="grid gap-2">
                {teams.map((t) => (
                  <li key={t.teamId}>
                    <Link
                      href={`/admin/?team=${encodeURIComponent(t.teamId)}`}
                      className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 font-semibold transition-opacity hover:opacity-90"
                      style={{ borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)" }}
                      data-team-link-row={t.teamId}
                    >
                      <span>{t.teamName}</span>
                      <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                        Manage →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {teams && teams.length > 0 ? (
              <div className="pt-1">
                <NewTeamButton />
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
