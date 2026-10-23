// New Season Setup: Team → Season → Roster → Ready.
//
// Pure helpers only. The guided setup keeps no state of its own: progress
// is derived from persisted records (team, season, roster) and the URL
// (?setup=1&step=…&team=…&setupSeason=…), so refresh, back/forward, and
// leaving and returning all resume from what actually exists.

import type { SeasonSummary } from "@/lib/seasonStore";
import type { SeasonBranding, Team } from "@/lib/branding";

export const SETUP_STEPS = ["team", "season", "roster", "ready"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const SEASON_TERMS = ["Spring", "Summer", "Fall", "Winter"] as const;
export type SeasonTerm = (typeof SEASON_TERMS)[number];

export function seasonLabelFor(term: SeasonTerm, year: number): string {
  return `${term} ${year}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Readable, unique-by-construction id, e.g. "falcons-spring-2027". */
export function proposeSeasonId(teamName: string, term: SeasonTerm, year: number): string {
  return `${slug(teamName) || "team"}-${term.toLowerCase()}-${year}`.slice(0, 63);
}

/** The next season's term and year after a date (Spring 2027 after fall 2026). */
export function nextSeasonAfter(date: Date): { term: SeasonTerm; year: number } {
  const m = date.getMonth(); // 0-11
  const y = date.getFullYear();
  if (m <= 2) return { term: "Spring", year: y };
  if (m <= 5) return { term: "Summer", year: y };
  if (m <= 8) return { term: "Fall", year: y };
  return { term: "Spring", year: y + 1 };
}

export type SeasonPlan =
  | { kind: "create"; seasonId: string; seasonLabel: string }
  | { kind: "resume"; season: SeasonSummary }
  | { kind: "conflict"; seasonId: string; reason: string };

/**
 * What creating `term year` for `team` would do:
 * - an existing *draft* of this team with this label (or id) is resumed;
 * - an id taken by anything else is a conflict (never overwritten or merged);
 * - otherwise a new draft is created.
 */
export function planSeason(
  seasons: SeasonSummary[],
  team: Pick<Team, "teamId" | "teamName">,
  term: SeasonTerm,
  year: number,
): SeasonPlan {
  const seasonLabel = seasonLabelFor(term, year);
  const seasonId = proposeSeasonId(team.teamName, term, year);
  const sameTeamDraft = seasons.find(
    (s) => s.teamId === team.teamId && s.status === "draft" && s.seasonLabel === seasonLabel,
  );
  if (sameTeamDraft) return { kind: "resume", season: sameTeamDraft };
  const taken = seasons.find((s) => s.seasonId === seasonId);
  if (taken) {
    const reason =
      taken.teamId === team.teamId
        ? `${taken.seasonLabel} already exists for ${team.teamName} and is ${taken.status ?? "in use"}, so setup will not change it.`
        : `The id "${seasonId}" is already used by ${taken.teamName} ${taken.seasonLabel}.`;
    return { kind: "conflict", seasonId, reason };
  }
  return { kind: "create", seasonId, seasonLabel };
}

/** Other in-progress drafts for a team, offered for resuming. */
export function draftsForTeam(seasons: SeasonSummary[], teamId: string): SeasonSummary[] {
  return seasons.filter((s) => s.teamId === teamId && s.status === "draft");
}

export type ReadinessItem = { key: string; label: string; ok: boolean; detail: string };

/**
 * Ready for first-game preparation: team and season exist, the season has
 * the team's valid branding snapshot, at least one player, and nothing
 * blocking (a finalized season is read-only). A lineup or game is not
 * required. Ready is not the same as current (Active).
 */
export function setupReadiness(input: {
  team: Team | null;
  season: SeasonSummary | null;
  branding: SeasonBranding | null;
  rosterCount: number;
}): { ready: boolean; items: ReadinessItem[] } {
  const { team, season, branding, rosterCount } = input;
  const items: ReadinessItem[] = [
    { key: "team", label: "Team", ok: !!team, detail: team ? team.teamName : "Choose or create a team" },
    { key: "season", label: "Season", ok: !!season, detail: season ? season.seasonLabel : "Create the season" },
    {
      key: "branding",
      label: "Branding",
      ok: !!branding && !!team && branding.teamId === team.teamId,
      detail: branding ? `${branding.teamName} colors and ${branding.logo ? "logo" : "initials"}` : "Missing branding snapshot",
    },
    {
      key: "roster",
      label: "Roster",
      ok: rosterCount > 0,
      detail: rosterCount > 0 ? `${rosterCount} player${rosterCount === 1 ? "" : "s"}` : "Add at least one player",
    },
    {
      key: "editable",
      label: "Editable",
      ok: !!season && season.status !== "finalized",
      detail: season?.status === "finalized" ? "Season is finalized (read-only)" : "Open for games",
    },
  ];
  return { ready: items.every((i) => i.ok), items };
}

/** Furthest step the persisted records allow (earlier steps are complete). */
export function furthestStep(input: {
  teamOk: boolean;
  seasonOk: boolean;
  rosterCount: number;
}): SetupStep {
  if (!input.teamOk) return "team";
  if (!input.seasonOk) return "season";
  if (input.rosterCount < 1) return "roster";
  return "ready";
}

/** The step to show: the requested one, unless prerequisites are missing. */
export function resolveStep(requested: string | null, furthest: SetupStep): SetupStep {
  const want = (SETUP_STEPS as readonly string[]).includes(requested ?? "")
    ? (requested as SetupStep)
    : "team";
  return SETUP_STEPS.indexOf(want) <= SETUP_STEPS.indexOf(furthest) ? want : furthest;
}

export function setupHref(params: { step: SetupStep; team?: string | null; season?: string | null }): string {
  const q = new URLSearchParams({ setup: "1", step: params.step });
  if (params.team) q.set("team", params.team);
  if (params.season) q.set("setupSeason", params.season);
  return `/admin/?${q.toString()}`;
}
