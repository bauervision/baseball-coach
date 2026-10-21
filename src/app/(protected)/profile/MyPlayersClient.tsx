"use client";

import * as React from "react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase.client";
import { useAdminAuth } from "@/app/(protected)/admin/_parts/useAdminAuth";
import { toastStyle } from "@/app/(protected)/admin/adminHelpers";
import {
  SELECT_CLASS,
  SELECT_STYLE,
} from "@/app/(protected)/admin/_parts/SeasonTab";
import { PLAYER_REGISTRY_ENABLED } from "@/lib/features";
import {
  createAndLinkChild,
  ensureManagedIdentity,
  linkExistingChild,
  listLinkedPlayers,
  listManagedIdentities,
  unlinkChild,
  type LinkedPlayer,
} from "@/lib/coachPlayersStore";
import {
  buildCandidatesFromRosters,
  mergeRegistryCandidates,
  searchCandidates,
  type PlayerCandidate,
} from "@/lib/playerSearch";
import { listSeasons, loadRosterSeasons } from "@/lib/seasonStore";

type Pending =
  | { kind: "link"; candidate: PlayerCandidate }
  | { kind: "create"; name: string }
  | { kind: "unlink"; player: LinkedPlayer };

function errorText(e: unknown, fallback: string): string {
  return e && typeof e === "object" && "message" in e
    ? String((e as { message?: unknown }).message)
    : fallback;
}

function candidateSummary(c: PlayerCandidate): string {
  const latest = c.seasons[0];
  if (!latest) return "No confirmed seasons yet";
  return `${latest.number > 0 ? `#${latest.number} · ` : ""}${latest.teamName} ${latest.seasonLabel}`;
}

export default function MyPlayersClient() {
  const auth = React.useMemo(() => getFirebaseAuth(), []);
  const db = React.useMemo(() => getFirestoreDb(), []);
  const { authReady, uid, canEdit } = useAdminAuth({ auth, db });

  const [linked, setLinked] = React.useState<LinkedPlayer[] | null>(null);
  const [candidates, setCandidates] = React.useState<PlayerCandidate[] | null>(
    null,
  );
  const [version, setVersion] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const [newName, setNewName] = React.useState("");
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!PLAYER_REGISTRY_ENABLED || !canEdit || !uid) return;
    let active = true;
    (async () => {
      const [linkedList, identities, seasons] = await Promise.all([
        listLinkedPlayers(db, uid),
        listManagedIdentities(db, uid),
        listSeasons(db),
      ]);
      const rosters = await loadRosterSeasons(db, seasons);
      const linkedIds = new Set(linkedList.map((l) => l.careerPlayerId));
      const all = mergeRegistryCandidates(
        buildCandidatesFromRosters(rosters, { uid }),
        identities,
        linkedIds,
      );
      if (!active) return;
      setLinked(linkedList);
      setCandidates(all);
    })().catch((e: unknown) => {
      if (active) setErr(errorText(e, "Failed to load your players."));
    });
    return () => {
      active = false;
    };
  }, [db, uid, canEdit, version]);

  const linkedIds = React.useMemo(
    () => new Set((linked ?? []).map((l) => l.careerPlayerId)),
    [linked],
  );
  const results = React.useMemo(
    () =>
      query.trim() && candidates
        ? searchCandidates(candidates, query).slice(0, 8)
        : [],
    [candidates, query],
  );

  async function confirmPending() {
    if (!pending || !uid) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (pending.kind === "link") {
        const c = pending.candidate;
        const ok = await ensureManagedIdentity({
          db,
          uid,
          careerPlayerId: c.careerPlayerId,
          displayName: c.displayName,
        });
        if (!ok) {
          throw new Error(
            `${c.displayName} is managed by another coach and can't be linked here.`,
          );
        }
        await linkExistingChild({
          db,
          uid,
          careerPlayerId: c.careerPlayerId,
          displayName: c.displayName,
        });
        setMsg(`${c.displayName} is now one of your players.`);
        setQuery("");
      } else if (pending.kind === "create") {
        await createAndLinkChild({ db, uid, displayName: pending.name });
        setMsg(`Added ${pending.name.trim()} as one of your players.`);
        setNewName("");
      } else {
        await unlinkChild({
          db,
          uid,
          careerPlayerId: pending.player.careerPlayerId,
        });
        setMsg(
          `${pending.player.displayName} is no longer linked to your account. Their history is unchanged.`,
        );
      }
      setPending(null);
      setVersion((v) => v + 1);
    } catch (e: unknown) {
      setErr(errorText(e, "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  if (!PLAYER_REGISTRY_ENABLED) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Players</CardTitle>
          <CardSubtitle>Coming soon</CardSubtitle>
        </CardHeader>
        <CardContent className="text-sm" style={{ color: "var(--muted)" }}>
          Linking your own children to your coach account is turned off until
          its private access rules are deployed.
        </CardContent>
      </Card>
    );
  }

  if (!authReady) {
    return (
      <div className="text-sm" style={{ color: "var(--muted)" }}>
        Checking sign-in…
      </div>
    );
  }

  if (!canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Players</CardTitle>
          <CardSubtitle>Coach sign-in required</CardSubtitle>
        </CardHeader>
        <CardContent className="text-sm" style={{ color: "var(--muted)" }}>
          Sign in on the{" "}
          <Link href="/admin" className="underline">
            Admin page
          </Link>{" "}
          to manage the players linked to your account.
        </CardContent>
      </Card>
    );
  }

  const pendingText =
    pending?.kind === "link"
      ? `Link ${pending.candidate.displayName} (${candidateSummary(pending.candidate)}) to your account as your child?`
      : pending?.kind === "create"
        ? `Create a new player named ${pending.name.trim()} and link them to your account as your child?`
        : pending?.kind === "unlink"
          ? `Unlink ${pending.player.displayName} from your account? Their seasons and stats stay exactly as they are.`
          : "";

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>My Players</CardTitle>
          <CardSubtitle>
            Your own children. They are preselected whenever you build a new
            roster, for any team. You can still deselect them.
          </CardSubtitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {linked === null ? (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Loading…
            </div>
          ) : linked.length === 0 ? (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              No players linked yet.
            </div>
          ) : (
            <ul className="grid gap-2">
              {linked.map((l) => (
                <li
                  key={l.careerPlayerId}
                  className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
                  style={{
                    borderColor:
                      "color-mix(in oklab, var(--stroke) 92%, transparent)",
                  }}
                >
                  <span className="text-sm font-semibold">{l.displayName}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setPending({ kind: "unlink", player: l })}
                  >
                    Unlink…
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <section aria-labelledby="link-existing-h" className="grid gap-2">
            <h3 id="link-existing-h" className="text-sm font-semibold">
              Link a player you have coached
            </h3>
            <label htmlFor="my-players-search" className="sr-only">
              Search players you have coached
            </label>
            <input
              id="my-players-search"
              type="search"
              autoComplete="off"
              placeholder="Search by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={SELECT_CLASS}
              style={SELECT_STYLE}
              disabled={busy || candidates === null}
            />
            {results.length > 0 ? (
              <ul className="grid gap-1" aria-label="Matching players">
                {results.map((c) => {
                  const isLinked = linkedIds.has(c.careerPlayerId);
                  const noId = !c.careerPlayerId;
                  return (
                    <li
                      key={c.key}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="font-semibold">{c.displayName}</span>
                        <span
                          className="block truncate text-xs"
                          style={{ color: "var(--muted)" }}
                        >
                          {candidateSummary(c)}
                          {c.seasons.length > 1
                            ? ` · ${c.seasons.length} seasons`
                            : ""}
                          {noId ? " · needs review before linking" : ""}
                        </span>
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy || isLinked || noId}
                        onClick={() => setPending({ kind: "link", candidate: c })}
                      >
                        {isLinked ? "Linked" : "Link…"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <section aria-labelledby="add-new-h" className="grid gap-2">
            <h3 id="add-new-h" className="text-sm font-semibold">
              Add a child who hasn&rsquo;t played yet
            </h3>
            <div className="flex flex-wrap gap-2">
              <label htmlFor="my-players-new" className="sr-only">
                Child&rsquo;s name
              </label>
              <input
                id="my-players-new"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Child's name"
                className={`${SELECT_CLASS} sm:max-w-xs`}
                style={SELECT_STYLE}
                disabled={busy}
                autoComplete="off"
              />
              <Button
                variant="secondary"
                disabled={busy || !newName.trim()}
                onClick={() => setPending({ kind: "create", name: newName })}
              >
                Add…
              </Button>
            </div>
          </section>

          {pending ? (
            <div
              role="alertdialog"
              aria-labelledby="my-players-confirm"
              className="grid gap-2 rounded-xl border px-3 py-2 text-sm"
              style={toastStyle(pending.kind === "unlink" ? "err" : "ok")}
            >
              <div id="my-players-confirm">{pendingText}</div>
              {pending.kind !== "unlink" ? (
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  Only link your own child. This is never inferred from names
                  or past rosters.
                </div>
              ) : null}
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={confirmPending}>
                  {busy ? "Saving…" : "Confirm"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setPending(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <div aria-live="polite" className="grid gap-2">
            {err ? (
              <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("err")}>
                {err}
              </div>
            ) : null}
            {msg ? (
              <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("ok")}>
                {msg}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
