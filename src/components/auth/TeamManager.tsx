"use client";

// One team in the coach workspace (/admin/?team={teamId}): its parent link,
// its own current season, and what parents can see. Firestore rules decide
// access: another coach's team id in the URL reads nothing ("not found").

import * as React from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink } from "lucide-react";

import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { getFirestoreDb } from "@/lib/firebase.client";
import { listOwnedTeamSeasons, type SeasonSummary } from "@/lib/seasonStore";
import { readOwnedTeam, setSeasonPublished, setTeamCurrentSeason, type OwnedTeam } from "@/lib/teamPublication";
import { teamHref, teamShareUrl } from "@/lib/teamRoutes";

function statusText(s: SeasonSummary): string {
  switch (s.status) {
    case "draft":
      return "Draft";
    case "finalized":
      return "Finalized";
    case "deleting":
      return "Being deleted";
    default:
      return "Active";
  }
}

function Chip(props: { children: React.ReactNode; tone?: "on" | "off" }) {
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[11px] font-bold"
      style={{
        borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background: props.tone === "on" ? "color-mix(in oklab, var(--primary) 18%, transparent)" : "transparent",
      }}
    >
      {props.children}
    </span>
  );
}

export function CopyTeamLink(props: { teamId: string }) {
  const [url, setUrl] = React.useState(() => teamHref(props.teamId));
  const [copied, setCopied] = React.useState<"yes" | "manual" | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => setUrl(teamShareUrl(window.location.origin, props.teamId)), [props.teamId]);
  React.useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 4000);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
    } catch {
      inputRef.current?.select();
      setCopied("manual");
    }
  }

  return (
    <div className="grid gap-2" data-team-link>
      <label className="text-xs font-semibold" style={{ color: "var(--muted)" }} htmlFor={`team-link-${props.teamId}`}>
        Parent link (stays the same every season)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={`team-link-${props.teamId}`}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"
          style={{ borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)", background: "transparent", color: "var(--foreground)" }}
        />
        <Button size="sm" onClick={() => void onCopy()} data-copy-team-link>
          {copied === "yes" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          Copy team link
        </Button>
        <a
          href={teamHref(props.teamId)}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-4"
        >
          View parent page <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
      <div role="status" aria-live="polite" className="min-h-4 text-xs" style={{ color: "var(--muted)" }}>
        {copied === "yes" ? "Link copied." : copied === "manual" ? "Press Ctrl+C (or ⌘C) to copy the selected link." : ""}
      </div>
    </div>
  );
}

export function TeamManager(props: { uid: string; teamId: string }) {
  const db = React.useMemo(() => getFirestoreDb(), []);
  const [team, setTeam] = React.useState<OwnedTeam | null | undefined>(undefined);
  const [seasons, setSeasons] = React.useState<SeasonSummary[] | null>(null);
  const [version, setVersion] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const headingRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    let active = true;
    (async () => {
      const t = await readOwnedTeam(db, props.teamId);
      const list = t ? await listOwnedTeamSeasons(db, props.uid, props.teamId).catch(() => []) : [];
      if (!active) return;
      setTeam(t);
      setSeasons(list);
    })();
    return () => {
      active = false;
    };
  }, [db, props.uid, props.teamId, version]);

  const loadState = team === undefined ? "loading" : team ? "found" : "missing";
  React.useEffect(() => {
    if (loadState !== "loading") headingRef.current?.focus({ preventScroll: true });
  }, [loadState]);

  async function run(key: string, action: () => Promise<string>) {
    if (busy) return;
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ kind: "ok", text: await action() });
      setVersion((v) => v + 1);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "That didn't work. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  if (team === undefined) {
    return (
      <div role="status" className="text-sm" style={{ color: "var(--muted)" }}>
        Loading team…
      </div>
    );
  }

  if (team === null) {
    return (
      <Card data-team-manager="notFound">
        <CardHeader>
          <CardTitle>
            <span ref={headingRef} tabIndex={-1} className="outline-none">
              Team not found
            </span>
          </CardTitle>
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

  const current = seasons?.find((s) => s.seasonId === team.currentSeasonId) ?? null;

  return (
    <Card data-team-manager={team.teamId}>
      <CardHeader>
        <Link href="/admin/" className="text-xs font-semibold underline underline-offset-4" style={{ color: "var(--muted)" }}>
          ← Your teams
        </Link>
        <CardTitle className="mt-1">
          <span ref={headingRef} tabIndex={-1} className="outline-none">
            {team.teamName}
          </span>
        </CardTitle>
        <CardSubtitle data-current-season>
          {current
            ? `Current season: ${current.seasonLabel}${current.published ? " · parents can see it" : " · not published yet"}`
            : "No current season yet."}
        </CardSubtitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <CopyTeamLink teamId={team.teamId} />

        <section aria-labelledby={`seasons-${team.teamId}`} className="grid gap-2">
          <h4 id={`seasons-${team.teamId}`} className="text-sm font-bold">
            Seasons
          </h4>
          {seasons === null ? (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Loading seasons…
            </div>
          ) : seasons.length === 0 ? (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              No seasons yet.
            </div>
          ) : (
            <ul className="grid gap-2">
              {seasons.map((s) => {
                const isCurrent = s.seasonId === team.currentSeasonId;
                const canPublish = s.status !== "draft" && s.status !== "deleting";
                return (
                  <li
                    key={s.seasonId}
                    data-season-row={s.seasonId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2"
                    style={{ borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)" }}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{s.seasonLabel}</span>
                      <Chip>{statusText(s)}</Chip>
                      {isCurrent ? <Chip tone="on">Current</Chip> : null}
                      <Chip tone={s.published ? "on" : "off"}>{s.published ? "Public" : "Not public"}</Chip>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!isCurrent && s.status !== "finalized" && s.status !== "deleting" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy !== null}
                          data-make-current={s.seasonId}
                          onClick={() =>
                            void run(`current:${s.seasonId}`, async () => {
                              const r = await setTeamCurrentSeason({ db, uid: props.uid, teamId: team.teamId, seasonId: s.seasonId });
                              return r.activated ? `${s.seasonLabel} is active and current.` : `${s.seasonLabel} is now the current season.`;
                            })
                          }
                        >
                          {s.status === "draft" ? "Activate and make current" : "Make current"}
                        </Button>
                      ) : null}
                      {canPublish ? (
                        <Button
                          size="sm"
                          variant={s.published ? "ghost" : "primary"}
                          disabled={busy !== null}
                          data-publish={s.seasonId}
                          onClick={() => {
                            if (s.published && !window.confirm(`Unpublish ${s.seasonLabel}? Parents will no longer see it.`)) return;
                            void run(`publish:${s.seasonId}`, async () => {
                              await setSeasonPublished({ db, uid: props.uid, teamId: team.teamId, seasonId: s.seasonId, published: !s.published });
                              return s.published ? `${s.seasonLabel} is no longer public.` : `${s.seasonLabel} is public.`;
                            });
                          }}
                        >
                          {s.published ? "Unpublish" : "Publish"}
                        </Button>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          {s.status === "draft" ? "Activate before publishing" : null}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div
            role={message?.kind === "error" ? "alert" : "status"}
            aria-live="polite"
            className="min-h-5 text-sm"
            data-team-message={message?.kind ?? ""}
          >
            {message?.text ?? ""}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
