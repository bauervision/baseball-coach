// Per-game player stat line for the public Game Log. Field names mirror
// the admin LineDelta persisted at seasons/{id}/games/{gid}/lines/{pid}.
//
// Kept free of imports so it can be unit tested with `node --test`.

export type GameLogDelta = {
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
  flyBallCatches: number;
  pitchingStrikeouts: number;
  pitchingSaves: number;
  /**
   * Batter strikeouts. Not entered by the current admin form; present only
   * on legacy lines that stored a `strikeouts` field.
   */
  strikeouts?: number;
};

const STORED_KEYS = [
  "atBats",
  "hits",
  "doubles",
  "triples",
  "homeRuns",
  "runs",
  "rbi",
  "walks",
  "hitByPitch",
  "stolenBases",
  "putOuts",
  "assists",
  "flyBallCatches",
  "pitchingStrikeouts",
  "pitchingSaves",
] as const;

function asCount(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.floor(v))
    : 0;
}

/** Missing or malformed fields (legacy lines) read as 0. */
export function normalizeGameLogDelta(raw: unknown): GameLogDelta {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as GameLogDelta;
  for (const k of STORED_KEYS) out[k] = asCount(d[k]);
  if ("strikeouts" in d) out.strikeouts = asCount(d.strikeouts);
  return out;
}

type StatKey = keyof GameLogDelta | "singles";

export type GameLogStatDef = {
  key: StatKey;
  /** Compact label, matching the admin entry form where one exists. */
  short: string;
  /** Full name for screen readers and tooltips. */
  name: string;
  /** Shown as a highlight chip in the collapsed card when nonzero. */
  highlight: boolean;
};

export type GameLogStatGroup = {
  id: "batting" | "baserunning" | "fielding" | "pitching";
  label: string;
  stats: GameLogStatDef[];
};

// AB/H/R/RBI/BB/HBP already appear in the collapsed summary sentence, so
// they are not repeated as highlight chips.
export const GAME_LOG_STAT_GROUPS: GameLogStatGroup[] = [
  {
    id: "batting",
    label: "Batting",
    stats: [
      { key: "atBats", short: "AB", name: "At bats", highlight: false },
      { key: "hits", short: "H", name: "Hits", highlight: false },
      { key: "singles", short: "1B", name: "Singles", highlight: false },
      { key: "doubles", short: "2B", name: "Doubles", highlight: true },
      { key: "triples", short: "3B", name: "Triples", highlight: true },
      { key: "homeRuns", short: "HR", name: "Home runs", highlight: true },
      { key: "runs", short: "R", name: "Runs", highlight: false },
      { key: "rbi", short: "RBI", name: "Runs batted in", highlight: false },
      { key: "walks", short: "BB", name: "Walks", highlight: false },
      { key: "hitByPitch", short: "HBP", name: "Hit by pitch", highlight: false },
      {
        key: "strikeouts",
        short: "K",
        name: "Strikeouts (batting)",
        highlight: true,
      },
    ],
  },
  {
    id: "baserunning",
    label: "Baserunning",
    stats: [
      { key: "stolenBases", short: "SB", name: "Stolen bases", highlight: true },
    ],
  },
  {
    id: "fielding",
    label: "Fielding",
    stats: [
      { key: "putOuts", short: "PO", name: "Put outs", highlight: true },
      { key: "assists", short: "A", name: "Assists", highlight: true },
      {
        key: "flyBallCatches",
        short: "Fly Balls",
        name: "Fly ball catches",
        highlight: true,
      },
    ],
  },
  {
    id: "pitching",
    label: "Pitching",
    stats: [
      {
        key: "pitchingStrikeouts",
        short: "Strikeouts",
        name: "Strikeouts (pitching)",
        highlight: true,
      },
      { key: "pitchingSaves", short: "Saves", name: "Saves", highlight: true },
    ],
  },
];

export type GameLogStatValue = GameLogStatDef & { value: number };

/** Singles aren't stored; they're hits minus extra-base hits. */
export function singlesFrom(d: GameLogDelta): number {
  return Math.max(0, d.hits - d.doubles - d.triples - d.homeRuns);
}

/**
 * Every stat for the expanded view, zeros included. The legacy batter
 * strikeout row only appears when that field was actually stored.
 */
export function gameLogStatGroups(
  d: GameLogDelta,
): Array<{ id: string; label: string; stats: GameLogStatValue[] }> {
  return GAME_LOG_STAT_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    stats: g.stats
      .filter((s) => s.key !== "strikeouts" || d.strikeouts !== undefined)
      .map((s) => ({
        ...s,
        value: s.key === "singles" ? singlesFrom(d) : (d[s.key] ?? 0),
      })),
  }));
}

/** Nonzero accomplishments for the collapsed card, with exact counts. */
export function gameLogHighlights(d: GameLogDelta): GameLogStatValue[] {
  return gameLogStatGroups(d)
    .flatMap((g) => g.stats)
    .filter((s) => s.highlight && s.value > 0);
}

/** Collapsed summary sentence (unchanged from the original Game Log). */
export function gameLogSummary(d: GameLogDelta): string {
  const bits: string[] = [`${d.hits} for ${d.atBats}`];
  if (d.runs > 0) bits.push(`${d.runs} ${d.runs === 1 ? "run" : "runs"}`);
  if (d.rbi > 0) bits.push(`${d.rbi} RBI`);
  if (d.walks > 0) bits.push(`${d.walks} BB`);
  if (d.hitByPitch > 0) bits.push(`${d.hitByPitch} HBP`);
  return bits.join(" • ");
}

/**
 * Hit streak shown on each Game Log card, oldest game first. Matches the
 * original Game Log: any game with a stat line or a Game Ball advances or
 * resets the streak. Games listed only for a Coach Choice (no stat line, no
 * Game Ball) were never in the log before; they leave the streak untouched
 * and show 0 themselves.
 */
export function gameLogHitStreaks(
  items: Array<{
    gameId: string;
    date: string;
    hasStatLine: boolean;
    gotGameBall: boolean;
    delta: { hits: number };
  }>,
): Map<string, number> {
  const out = new Map<string, number>();
  let streak = 0;
  for (const item of [...items].sort((a, b) => a.date.localeCompare(b.date))) {
    const counts = item.hasStatLine || item.gotGameBall;
    if (counts) streak = item.delta.hits > 0 ? streak + 1 : 0;
    // Uncounted games don't display the running streak as their own.
    out.set(item.gameId, counts ? streak : 0);
  }
  return out;
}
