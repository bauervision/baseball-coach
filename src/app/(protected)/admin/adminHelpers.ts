import { PlayerBattingStats } from "@/lib/roster";

export type GameResult = "W" | "L" | "T";

export type LineDelta = {
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  runs: number;
  rbi: number;
  walks: number;
  hitByPitch: number;
  stolenBases: number;

  putOuts: number;
  assists: number;

  pitchingStrikeouts: number;
  pitchingSaves: number;
  flyBallCatches: number;
};

export type LineState = {
  hidden: boolean;
  delta: LineDelta;
};

export const EMPTY_DELTA: LineDelta = {
  atBats: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  runs: 0,
  rbi: 0,
  walks: 0,
  hitByPitch: 0,
  stolenBases: 0,

  putOuts: 0,
  assists: 0,

  pitchingStrikeouts: 0,
  pitchingSaves: 0,
  flyBallCatches: 0,
};

export function anyNonZero(d: LineDelta) {
  return (
    d.atBats !== 0 ||
    d.hits !== 0 ||
    d.doubles !== 0 ||
    d.triples !== 0 ||
    d.homeRuns !== 0 ||
    d.runs !== 0 ||
    d.rbi !== 0 ||
    d.walks !== 0 ||
    d.hitByPitch !== 0 ||
    d.stolenBases !== 0 ||
    d.putOuts !== 0 ||
    d.assists !== 0 ||
    d.pitchingStrikeouts !== 0 ||
    d.pitchingSaves !== 0 ||
    d.flyBallCatches !== 0
  );
}

export function num(v: string): number {
  const t = v.trim();
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

export function todayISO() {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export type AdminTab = "stats" | "players" | "season" | "lineup";

export type DraftPlayer = {
  key: string;
  name: string;
  number: string; // optional input
  primaryPos: string; // optional input
};

export const EMPTY_STATS: PlayerBattingStats = {
  games: 0,
  plateAppearances: 0,
  atBats: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  runs: 0,
  rbi: 0,
  walks: 0,
  pitchingStrikeouts: 0,
  hitByPitch: 0,
  putOuts: 0,
  assists: 0,
  stolenBases: 0,
  pitchingSaves: 0,
  flyBallCatches: 0,
  charlieHustleAwards: 0,
  mostImprovedAwards: 0,
  bestPitcherAwards: 0,
  bestCatcherAwards: 0,
  bestFirstBasemanAwards: 0,
  bestSecondBasemanAwards: 0,
  bestThirdBasemanAwards: 0,
  bestShortstopAwards: 0,
  bestLeftFielderAwards: 0,
  bestCenterFielderAwards: 0,
  bestRightFielderAwards: 0,
};

export function newDraftPlayer(): DraftPlayer {
  return {
    key: `dp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: "",
    number: "",
    primaryPos: "",
  };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseOptionalInt(s: string): number {
  const raw = s.trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export function playerDocIdFromDraft(d: DraftPlayer, idx: number): string {
  const nameSlug = slugify(d.name) || `player-${idx + 1}`;
  const n = parseOptionalInt(d.number);
  if (n > 0) return `${String(n).padStart(2, "0")}-${nameSlug}`;
  return `p${String(idx + 1).padStart(2, "0")}-${nameSlug}`;
}

export function toastStyle(kind: "err" | "ok") {
  return {
    borderColor:
      kind === "err"
        ? "color-mix(in oklab, var(--accent) 35%, transparent)"
        : "color-mix(in oklab, var(--accent-2) 35%, transparent)",
    background:
      kind === "err"
        ? "color-mix(in oklab, var(--accent) 12%, transparent)"
        : "color-mix(in oklab, var(--accent-2) 12%, transparent)",
    color: "var(--foreground)",
  } as const;
}

export type CoachPickKey =
  | "charlieHustle"
  | "mostImproved"
  | "bestPitcher"
  | "bestCatcher"
  | "bestFirstBaseman"
  | "bestSecondBaseman"
  | "bestThirdBaseman"
  | "bestShortstop"
  | "bestLeftFielder"
  | "bestCenterFielder"
  | "bestRightFielder";

export type CoachPicks = Record<CoachPickKey, string>;

export const EMPTY_COACH_PICKS: CoachPicks = {
  charlieHustle: "",
  mostImproved: "",
  bestPitcher: "",
  bestCatcher: "",
  bestFirstBaseman: "",
  bestSecondBaseman: "",
  bestThirdBaseman: "",
  bestShortstop: "",
  bestLeftFielder: "",
  bestCenterFielder: "",
  bestRightFielder: "",
};
