"use client";

// Multi-coach mode Admin entry: decides access from Firebase Auth + Firestore
// (coaches/{uid}, invitations) before showing anything private. Approved
// coaches land in their workspace; everyone else sees "Access not enabled".
// Team and season management for new workspaces arrives with onboarding
// (next checkpoint); this view lists the coach's own teams only.

import * as React from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";

import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase.client";
import { clearSession, readSession } from "@/lib/session";
import { resolveCoachAccess, type CoachAccess } from "@/lib/coachAccess";

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
        <Button onClick={() => clearSession()}>Sign in</Button>
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
  const headingRef = useFocusOnChange("approved");
  const [teams, setTeams] = React.useState<Array<{ id: string; name: string }> | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    // Scoped query: rules only allow the coach's own teams.
    getDocs(query(collection(db, "teams"), where("ownerUid", "==", props.user.uid)))
      .then((snap) => {
        if (active) setTeams(snap.docs.map((d) => ({ id: d.id, name: String(d.data().teamName ?? d.id) })).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        if (active) setErr("Your teams couldn't be loaded.");
      });
    return () => {
      active = false;
    };
  }, [db, props.user.uid]);

  return (
    <Card data-coach-gate="approved" data-workspace-id={props.workspaceId}>
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>
            <span ref={headingRef} tabIndex={-1} className="outline-none">
              Your workspace
            </span>
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={() => void props.onSignOutAction()}>
            Sign out
          </Button>
        </div>
        <CardSubtitle>Signed in as {props.user.email ?? "coach"}</CardSubtitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {err ? (
          <div role="alert" className="text-sm">{err}</div>
        ) : teams === null ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Loading teams…
          </div>
        ) : teams.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }} data-empty-workspace>
            No teams yet. Team and season setup for new workspaces is coming next.
          </div>
        ) : (
          <ul aria-label="Your teams" className="grid gap-1 text-sm">
            {teams.map((t) => (
              <li key={t.id} className="font-semibold">
                {t.name}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
