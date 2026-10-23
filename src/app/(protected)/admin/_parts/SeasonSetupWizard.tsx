// app/admin/_parts/SeasonSetupWizard.tsx
"use client";

// New Season Setup: Team → Season → Roster → Ready.
//
// Orchestrates existing pieces only: the Team Designer (setup mode), the
// safe draft-season creation action, the additive Roster Builder with
// returning-player import, and the explicit Make Current action. Progress
// is derived from persisted records plus the URL, so refresh, back/forward,
// and leaving and returning resume where the data actually is; nothing is
// kept in browser storage.

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Firestore } from "firebase/firestore";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TeamMark } from "@/components/theme/BrandingProvider";
import { useRosterPlayers } from "@/lib/rosterStore";
import { listSeasons, type SeasonSummary } from "@/lib/seasonStore";
import { listTeams } from "@/lib/teamStore";
import { invalidateSeasonList } from "@/components/season/SeasonSelector";
import { PLAYER_REGISTRY_ENABLED } from "@/lib/features";
import { sportLabel, type Team } from "@/lib/branding";
import {
  SEASON_TERMS,
  SETUP_STEPS,
  draftsForTeam,
  furthestStep,
  nextSeasonAfter,
  planSeason,
  resolveStep,
  setupHref,
  setupReadiness,
  type SeasonTerm,
  type SetupStep,
} from "@/lib/seasonSetup";
import { toastStyle } from "../adminHelpers";
import { createSeasonOrResume, makeCurrentSeason } from "./adminActions";
import { RosterBuilderTab } from "./RosterBuilderTab";
import { SELECT_CLASS, SELECT_STYLE } from "./SeasonTab";
import { TeamDesignerTab } from "./TeamDesignerTab";
import { useRosterDraft } from "./useRosterDraft";

const STEP_LABELS: Record<SetupStep, string> = {
  team: "Team",
  season: "Season",
  roster: "Roster",
  ready: "Ready",
};
// Season ids may not look like Firestore's reserved __name__ form.
const NO_SEASON = "setup-no-season";
export const LEAVE_SETUP_PROMPT = "Leave this step? Unsaved changes will be lost.";

function errorText(e: unknown, fallback: string): string {
  return e && typeof e === "object" && "message" in e
    ? String((e as { message?: unknown }).message)
    : fallback;
}

function TeamChoice(props: { team: Team; selected: boolean; onSelectAction: () => void; disabled?: boolean }) {
  const { team, selected } = props;
  const p = team.palettes.dark;
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={props.disabled}
      onClick={props.onSelectAction}
      className="flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left disabled:opacity-60"
      style={{
        borderColor: selected ? "color-mix(in oklab, var(--secondary) 75%, transparent)" : "var(--stroke)",
        background: selected ? "color-mix(in oklab, var(--primary) 14%, var(--card))" : "color-mix(in oklab, var(--bg-base) 55%, transparent)",
      }}
    >
      <span className="h-9 w-9 shrink-0" style={{ ["--primary" as string]: p.primary, ["--secondary" as string]: p.secondary }}>
        <TeamMark
          branding={team}
          style={{
            background: p.primary,
            WebkitMaskImage: "var(--team-logo-mark)",
            maskImage: "var(--team-logo-mark)",
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            width: "100%",
            height: "100%",
          }}
          monogramStyle={{ fontSize: 12 }}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{team.teamName}</span>
        <span className="block truncate text-xs" style={{ color: "var(--muted)" }}>
          {sportLabel(team.sport)}
          {team.division ? ` · ${team.division}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 gap-1" aria-hidden="true">
        {[p.bgBase, p.primary, p.secondary].map((c, i) => (
          <span key={i} className="h-4 w-4 rounded-full border" style={{ background: c, borderColor: "var(--stroke)" }} />
        ))}
      </span>
    </button>
  );
}

export function SeasonSetupWizard(props: {
  db: Firestore;
  uid: string | null;
  canEdit: boolean;
  teams: Team[] | null;
  seasons: SeasonSummary[] | null;
  currentSeasonId: string;
  onTeamsChangedAction: () => void;
  onSeasonsChangedAction: () => void;
  onDirtyChangeAction: (dirty: boolean) => void;
  onExitAction: () => void;
  onOpenLineupAction: () => void;
}) {
  const { db, uid, canEdit, currentSeasonId } = props;
  const router = useRouter();
  const sp = useSearchParams();
  const teamParam = sp.get("team");
  const seasonParam = sp.get("setupSeason");

  // Re-read lists right after our own writes instead of waiting for the
  // parent's refresh, so a just-created record is never "missing".
  const [localTeams, setLocalTeams] = React.useState<Team[] | null>(null);
  const [localSeasons, setLocalSeasons] = React.useState<SeasonSummary[] | null>(null);
  const teams = localTeams ?? props.teams;
  const seasons = localSeasons ?? props.seasons;
  React.useEffect(() => setLocalTeams(null), [props.teams]);
  React.useEffect(() => setLocalSeasons(null), [props.seasons]);

  async function reloadTeams() {
    setLocalTeams(await listTeams(db));
    props.onTeamsChangedAction();
  }
  async function reloadSeasons() {
    setLocalSeasons(await listSeasons(db));
    invalidateSeasonList();
    props.onSeasonsChangedAction();
  }

  const team = teams?.find((t) => t.teamId === teamParam) ?? null;
  const season =
    seasons?.find((s) => s.seasonId === seasonParam && s.teamId === team?.teamId) ?? null;
  const live = useRosterPlayers(season?.seasonId ?? NO_SEASON);
  const roster = season ? (live.players ?? null) : [];
  const rosterCount = roster?.length ?? 0;
  const returningCount = (roster ?? []).filter((p) => p.returningPlayer || (p.linkedFrom?.length ?? 0) > 0).length;

  const loading = teams === null || seasons === null || (season !== null && roster === null);
  const furthest = furthestStep({ teamOk: !!team, seasonOk: !!season, rosterCount });
  // While records load, show the step the URL asks for (no flash of step
  // 1 after a refresh); once loaded, fall back only if a prerequisite is
  // genuinely missing.
  const step = loading ? resolveStep(sp.get("step"), "ready") : resolveStep(sp.get("step"), furthest);

  // Unsaved work in the embedded designer or roster builder.
  const [designerDirty, setDesignerDirty] = React.useState(false);
  const rosterDraft = useRosterDraft({
    db,
    uid,
    seasons,
    defaultSeasonId: season?.seasonId ?? "",
    canEdit,
  });
  const rosterPending = step === "roster" && rosterDraft.pendingCount > 0;
  const dirty = (step === "team" && designerDirty) || rosterPending;
  const { onDirtyChangeAction } = props;
  React.useEffect(() => onDirtyChangeAction(dirty), [dirty, onDirtyChangeAction]);
  React.useEffect(() => {
    if (!rosterPending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [rosterPending]);

  function go(next: SetupStep, ids: { team?: string | null; season?: string | null } = {}, force = false) {
    if (!force && dirty && !window.confirm(LEAVE_SETUP_PROMPT)) return;
    const t = ids.team !== undefined ? ids.team : teamParam;
    const s = ids.season !== undefined ? ids.season : seasonParam;
    router.push(setupHref({ step: next, team: t, season: s }), { scroll: false });
  }

  function exit() {
    if (dirty && !window.confirm(LEAVE_SETUP_PROMPT)) return;
    props.onExitAction();
  }

  // ---------------------------------------------------------------- team
  const [teamMode, setTeamMode] = React.useState<"existing" | "new" | null>(null);
  const [template, setTemplate] = React.useState<"blank" | "tigers">("blank");
  const mode = teamMode ?? ((teams?.length ?? 0) > 0 ? "existing" : "new");

  // ---------------------------------------------------------------- season
  const suggested = React.useMemo(() => nextSeasonAfter(new Date()), []);
  const [term, setTerm] = React.useState<SeasonTerm>(suggested.term);
  const [year, setYear] = React.useState(String(suggested.year));
  const [scheduled, setScheduled] = React.useState("10");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const creatingRef = React.useRef(false);
  const yearNum = Number.parseInt(year, 10);
  const yearOk = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100;
  const plan = team && seasons && yearOk ? planSeason(seasons, team, term, yearNum) : null;
  // Other drafts to resume (the one matching the form is the main action).
  const otherDrafts =
    team && seasons
      ? draftsForTeam(seasons, team.teamId).filter(
          (d) => !(plan?.kind === "resume" && plan.season.seasonId === d.seasonId),
        )
      : [];

  async function createOrResume() {
    if (!team || !plan || creatingRef.current) return;
    if (plan.kind === "resume") {
      go("roster", { season: plan.season.seasonId });
      return;
    }
    if (plan.kind !== "create") return;
    creatingRef.current = true; // blocks a double submit before re-render
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await createSeasonOrResume({
        db,
        uid: uid ?? "",
        team,
        seasonId: plan.seasonId,
        seasonLabel: plan.seasonLabel,
        scheduledGames: Math.max(0, Number.parseInt(scheduled, 10) || 0),
        existingSeasonIds: (seasons ?? []).map((s) => s.seasonId),
      });
      await reloadSeasons();
      go("roster", { season: res.seasonId }, true);
    } catch (e: unknown) {
      setErr(errorText(e, "Could not create the season."));
    } finally {
      creatingRef.current = false;
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- ready
  const readiness = setupReadiness({ team, season, branding: season?.branding ?? null, rosterCount });
  const isCurrent = !!season && season.seasonId === currentSeasonId;
  const currentSeason = (seasons ?? []).find((s) => s.seasonId === currentSeasonId);
  const [confirm, setConfirm] = React.useState<null | "current" | "lineup">(null);
  const activatingRef = React.useRef(false);

  async function activate(then: "stay" | "lineup") {
    if (!season || activatingRef.current) return;
    activatingRef.current = true;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await makeCurrentSeason({ db, seasonId: season.seasonId, uid: uid ?? undefined });
      await reloadSeasons();
      setConfirm(null);
      if (then === "lineup") props.onOpenLineupAction();
      else setMsg(`${season.seasonLabel} — ${season.teamName} is now the current season.`);
    } catch (e: unknown) {
      setErr(errorText(e, "Could not make the season current."));
    } finally {
      activatingRef.current = false;
      setBusy(false);
    }
  }

  const furthestIndex = SETUP_STEPS.indexOf(furthest);
  const disabled = !canEdit || busy;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>New season setup</CardTitle>
              <CardSubtitle>
                {team ? team.teamName : "Choose a team"}
                {season ? ` · ${season.seasonLabel}` : ""}
                {currentSeason ? ` — current season stays ${currentSeason.seasonLabel} (${currentSeason.teamName}) until you change it` : ""}
              </CardSubtitle>
            </div>
            <Button variant="ghost" size="sm" onClick={exit}>
              Exit setup
            </Button>
          </div>
          <nav aria-label="Setup progress" className="mt-3">
            <ol className="flex flex-wrap items-center gap-1.5">
              {SETUP_STEPS.map((s, i) => {
                const done = i < furthestIndex || (s === "ready" && readiness.ready && furthest === "ready");
                const reachable = i <= furthestIndex;
                const active = s === step;
                return (
                  <li key={s} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-current={active ? "step" : undefined}
                      disabled={!reachable || active}
                      onClick={() => go(s)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold disabled:cursor-default"
                      style={{
                        borderColor: active ? "color-mix(in oklab, var(--secondary) 75%, transparent)" : "var(--stroke)",
                        background: active
                          ? "linear-gradient(90deg, var(--primary), var(--secondary))"
                          : done
                            ? "color-mix(in oklab, var(--primary) 14%, var(--card))"
                            : "transparent",
                        color: active ? "rgba(0,0,0,0.92)" : reachable ? "var(--foreground)" : "var(--muted)",
                        opacity: reachable ? 1 : 0.6,
                      }}
                    >
                      <span aria-hidden="true">{done && !active ? "✓" : i + 1}</span>
                      {STEP_LABELS[s]}
                      {done && !active ? <span className="sr-only"> (complete)</span> : null}
                    </button>
                    {i < SETUP_STEPS.length - 1 ? (
                      <span aria-hidden="true" style={{ color: "var(--muted)" }}>
                        →
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </nav>
        </CardHeader>

        <CardContent className="grid gap-3">
          {loading ? (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Loading…
            </div>
          ) : null}

          {!loading && step === "team" ? (
            <div className="grid gap-3">
              <div role="radiogroup" aria-label="Team" className="flex flex-wrap gap-2">
                {(
                  [
                    ["existing", "Use an existing team"],
                    ["new", "Create a new team"],
                  ] as const
                ).map(([v, label]) => (
                  <label key={v} className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold">
                    <input
                      type="radio"
                      name="setup-team-mode"
                      className="h-4 w-4 accent-[var(--primary)]"
                      checked={mode === v}
                      disabled={disabled || (v === "existing" && (teams?.length ?? 0) === 0)}
                      onChange={() => {
                        if (designerDirty && !window.confirm(LEAVE_SETUP_PROMPT)) return;
                        setTeamMode(v);
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>

              {mode === "existing" ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(teams ?? []).map((t) => (
                      <TeamChoice
                        key={t.teamId}
                        team={t}
                        selected={t.teamId === team?.teamId}
                        disabled={disabled}
                        onSelectAction={() => go("team", { team: t.teamId, season: null })}
                      />
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button disabled={disabled || !team} onClick={() => go("season")}>
                      Next: Season
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                      Start from
                    </span>
                    {(
                      [
                        ["blank", "Blank team"],
                        ["tigers", "Original Tigers look"],
                      ] as const
                    ).map(([v, label]) => (
                      <label key={v} className="inline-flex min-h-9 items-center gap-1.5">
                        <input
                          type="radio"
                          name="setup-team-template"
                          className="h-4 w-4 accent-[var(--primary)]"
                          checked={template === v}
                          disabled={disabled}
                          onChange={() => {
                            if (designerDirty && !window.confirm(LEAVE_SETUP_PROMPT)) return;
                            setTemplate(v);
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <TeamDesignerTab
                    key={template}
                    db={db}
                    canEdit={canEdit}
                    teams={teams}
                    seasons={seasons}
                    onTeamsChangedAction={() => undefined}
                    onSeasonsChangedAction={() => undefined}
                    onDirtyChangeAction={setDesignerDirty}
                    setup={{
                      template,
                      onSavedAction: async (t) => {
                        setDesignerDirty(false);
                        await reloadTeams();
                        go("season", { team: t.teamId, season: null }, true);
                      },
                    }}
                  />
                </>
              )}
            </div>
          ) : null}

          {!loading && step === "season" && team ? (
            <div className="grid gap-3">
              {otherDrafts.length ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                    Drafts in progress
                  </span>
                  {otherDrafts.map((d) => (
                    <Button key={d.seasonId} size="sm" variant="secondary" disabled={disabled} onClick={() => go("roster", { season: d.seasonId })}>
                      Resume {d.seasonLabel}
                    </Button>
                  ))}
                </div>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,8rem)_minmax(0,10rem)] sm:items-end">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>Season</span>
                  <select aria-label="Season term" className={SELECT_CLASS} style={SELECT_STYLE} value={term} disabled={disabled} onChange={(e) => setTerm(e.target.value as SeasonTerm)}>
                    {SEASON_TERMS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>Year</span>
                  <input aria-label="Season year" className={SELECT_CLASS} style={SELECT_STYLE} inputMode="numeric" value={year} disabled={disabled} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-invalid={!yearOk} />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>Scheduled games</span>
                  <input aria-label="Scheduled games" className={SELECT_CLASS} style={SELECT_STYLE} inputMode="numeric" value={scheduled} disabled={disabled} onChange={(e) => setScheduled(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                </label>
              </div>
              <div role="status" className="text-sm">
                {!yearOk ? (
                  <span style={{ color: "#fb7185" }}>Enter a year between 2000 and 2100.</span>
                ) : plan?.kind === "create" ? (
                  <>
                    Creates <strong>{plan.seasonLabel}</strong> for {team.teamName} as a <strong>draft</strong> (id <code>{plan.seasonId}</code>), with {team.teamName}&rsquo;s branding.
                  </>
                ) : plan?.kind === "resume" ? (
                  <>
                    <strong>{plan.season.seasonLabel}</strong> is already a draft for {team.teamName}. Resume it instead of creating a duplicate.
                  </>
                ) : plan?.kind === "conflict" ? (
                  <span style={{ color: "#fb7185" }}>{plan.reason}</span>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <Button variant="ghost" onClick={() => go("team")}>Back</Button>
                <Button disabled={disabled || !plan || plan.kind === "conflict"} onClick={createOrResume}>
                  {busy ? "Creating…" : plan?.kind === "resume" ? `Resume ${plan.season.seasonLabel}` : "Create draft season"}
                </Button>
              </div>
            </div>
          ) : null}

          {!loading && (step === "roster" || step === "ready") && season ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--stroke)" }} role="status">
              <strong>
                {season.seasonLabel} — {season.teamName}
              </strong>
              <span>
                {rosterCount} player{rosterCount === 1 ? "" : "s"}
              </span>
              <span>{returningCount} returning</span>
              <span style={{ color: "var(--muted)" }}>
                {isCurrent ? "Active · current season" : season.status === "draft" ? "Draft · not current" : "Open · not current"}
              </span>
            </div>
          ) : null}

          {!loading && step === "roster" && season ? (
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={() => go("season")}>Back</Button>
              <span className="flex items-center gap-2">
                {rosterCount === 0 ? (
                  <span className="text-xs" style={{ color: "var(--muted)" }}>Add at least one player to continue.</span>
                ) : null}
                <Button disabled={disabled || rosterCount === 0} onClick={() => go("ready")}>
                  Next: Ready
                </Button>
              </span>
            </div>
          ) : null}

          {!loading && step === "ready" && season && team ? (
            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                  <dt style={{ color: "var(--muted)" }}>Team</dt>
                  <dd>{team.teamName} · {sportLabel(team.sport)}</dd>
                  <dt style={{ color: "var(--muted)" }}>Division</dt>
                  <dd>{team.division || "—"}</dd>
                  <dt style={{ color: "var(--muted)" }}>Season</dt>
                  <dd>{season.seasonLabel}</dd>
                  <dt style={{ color: "var(--muted)" }}>Roster</dt>
                  <dd>
                    {rosterCount} player{rosterCount === 1 ? "" : "s"} · {returningCount} returning
                  </dd>
                  <dt style={{ color: "var(--muted)" }}>Branding</dt>
                  <dd className="flex items-center gap-1.5">
                    {season.branding
                      ? [season.branding.palettes.dark.primary, season.branding.palettes.dark.secondary, season.branding.palettes.light.primary].map((c, i) => (
                          <span key={i} aria-hidden="true" className="h-4 w-4 rounded-full border" style={{ background: c, borderColor: "var(--stroke)" }} />
                        ))
                      : null}
                    <span>{season.branding ? `${season.branding.teamName} snapshot` : "missing"}</span>
                  </dd>
                  <dt style={{ color: "var(--muted)" }}>Status</dt>
                  <dd>
                    <strong>{readiness.ready ? "Ready" : "Not ready"}</strong>
                    {" · "}
                    {isCurrent ? "Active (current season)" : season.status === "draft" ? "Draft" : season.status ?? "Open"}
                  </dd>
                </dl>
                <ul className="grid content-start gap-1 text-sm" aria-label="Readiness">
                  {readiness.items.map((i) => (
                    <li key={i.key} className="flex items-center gap-2">
                      <span aria-hidden="true" style={{ color: i.ok ? "var(--accent-2)" : "#fb7185" }}>{i.ok ? "✓" : "✕"}</span>
                      <span className="font-semibold">{i.label}</span>
                      <span style={{ color: "var(--muted)" }}>{i.detail}</span>
                      <span className="sr-only">{i.ok ? "complete" : "incomplete"}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {confirm ? (
                <div role="alertdialog" aria-labelledby="setup-confirm" className="grid gap-2 rounded-xl border px-3 py-2 text-sm" style={toastStyle("ok")}>
                  <div id="setup-confirm">
                    {confirm === "lineup" ? "Lineups and game entry use the current season. " : ""}
                    Make <strong>{season.seasonLabel} — {season.teamName}</strong> the current season?{" "}
                    {currentSeason ? `${currentSeason.seasonLabel} (${currentSeason.teamName}) stops being current; its records are not changed. ` : ""}
                    Parents will see the new season by default.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={disabled} onClick={() => activate(confirm === "lineup" ? "lineup" : "stay")}>
                      {busy ? "Saving…" : confirm === "lineup" ? "Make current and open lineup" : "Make current"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap justify-between gap-2">
                  <Button variant="ghost" onClick={() => go("roster")}>Review roster</Button>
                  <span className="flex flex-wrap gap-2">
                    {!isCurrent ? (
                      <Button variant="secondary" disabled={disabled || !readiness.ready} onClick={() => setConfirm("current")}>
                        Make this the current season
                      </Button>
                    ) : null}
                    <Button
                      disabled={disabled || !readiness.ready}
                      onClick={() => (isCurrent ? props.onOpenLineupAction() : setConfirm("lineup"))}
                    >
                      Prepare first game
                    </Button>
                  </span>
                </div>
              )}
            </div>
          ) : null}

          <div aria-live="polite" className="grid gap-2">
            {err ? <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("err")}>{err}</div> : null}
            {msg ? <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("ok")}>{msg}</div> : null}
          </div>
        </CardContent>
      </Card>

      {!loading && step === "roster" && season ? (
        <>
          {!PLAYER_REGISTRY_ENABLED ? (
            <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--stroke)", color: "var(--muted)" }}>
              Automatic linked children (My Players) are not enabled. Add your own child as a returning or new player below.
            </div>
          ) : null}
          <RosterBuilderTab canEdit={canEdit} seasons={seasons} roster={rosterDraft} lockedSeason />
        </>
      ) : null}
    </div>
  );
}
