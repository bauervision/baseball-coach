//src/lib/roster.ts
export type PlayerBattingStats = {
  games: number;
  plateAppearances: number;
  atBats: number;
  hits: number;
  currentHitStreak: number;
  longestHitStreak: number;
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
  charlieHustleAwards: number;
  mostImprovedAwards: number;
  bestPitcherAwards: number;
  bestCatcherAwards: number;
  bestFirstBasemanAwards: number;
  bestSecondBasemanAwards: number;
  bestThirdBasemanAwards: number;
  bestShortstopAwards: number;
  bestLeftFielderAwards: number;
  bestCenterFielderAwards: number;
  bestRightFielderAwards: number;
};

export type ShirtSize =
  | "YXS"
  | "YS"
  | "YM"
  | "YL"
  | "YXL"
  | "AS"
  | "AM"
  | "AL"
  | "AXL";

export type Player = {
  id: string;
  careerPlayerId?: string;
  name: string;
  number: number;
  shirtSize?: ShirtSize | null;
  primaryPos?: string;
  leaderboardHidden?: boolean;
  returningPlayer?: boolean;
  stats: PlayerBattingStats;
};

export type TeamRecord = {
  wins: number;
  losses: number;
  ties?: number;
};

export function battingAverage(p: Player): number {
  const ab = p.stats.atBats;
  if (ab <= 0) return 0;
  return p.stats.hits / ab;
}

export function onBasePercentage(p: Player): number {
  const s = p.stats;
  const denom = s.atBats + s.walks + s.hitByPitch;
  if (denom <= 0) return 0;
  return (s.hits + s.walks + s.hitByPitch) / denom;
}

export function slugging(p: Player): number {
  const s = p.stats;
  if (s.atBats <= 0) return 0;

  const singles = Math.max(0, s.hits - s.doubles - s.triples - s.homeRuns);
  const totalBases =
    singles * 1 + s.doubles * 2 + s.triples * 3 + s.homeRuns * 4;

  return totalBases / s.atBats;
}

export function ops(p: Player): number {
  return onBasePercentage(p) + slugging(p);
}

export function fmt3(n: number): string {
  const s = n.toFixed(3);
  return s.startsWith("0") ? s.slice(1) : s;
}

export type StatKey =
  | "avg"
  | "obp"
  | "slg"
  | "ops"
  | "hits"
  | "longestHitStreak"
  | "atBats"
  | "rbi"
  | "runs"
  | "walks"
  | "hitByPitch"
  | "doubles"
  | "triples"
  | "homeRuns"
  | "stolenBases"
  | "putOuts"
  | "assists"
  | "pitchingStrikeouts";

export type LeadersMap = Record<StatKey, string[]>;

function near(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

function statValue(p: Player, k: StatKey): number {
  switch (k) {
    case "avg":
      return battingAverage(p);
    case "obp":
      return onBasePercentage(p);
    case "slg":
      return slugging(p);
    case "ops":
      return ops(p);
    case "hits":
      return p.stats.hits;
    case "longestHitStreak":
      return p.stats.longestHitStreak ?? 0;
    case "atBats":
      return p.stats.atBats;
    case "rbi":
      return p.stats.rbi;
    case "runs":
      return p.stats.runs;
    case "walks":
      return p.stats.walks;
    case "hitByPitch":
      return p.stats.hitByPitch;
    case "doubles":
      return p.stats.doubles;
    case "triples":
      return p.stats.triples;
    case "homeRuns":
      return p.stats.homeRuns;
    case "stolenBases":
      return p.stats.stolenBases;
    case "putOuts":
      return p.stats.putOuts;
    case "assists":
      return p.stats.assists;
    case "pitchingStrikeouts":
      return p.stats.pitchingStrikeouts;
  }
}

function isRate(k: StatKey): boolean {
  return k === "avg" || k === "obp" || k === "slg" || k === "ops";
}

function eligibleForRate(p: Player, k: StatKey): boolean {
  const s = p.stats;

  if (k === "avg" || k === "slg" || k === "ops") return s.atBats > 0;
  if (k === "obp") return s.atBats + s.walks + s.hitByPitch > 0;

  return false;
}

export function computeLeaders(players: Player[]): LeadersMap {
  const keys: StatKey[] = [
    "avg",
    "obp",
    "slg",
    "ops",
    "hits",
    "longestHitStreak",
    "atBats",
    "rbi",
    "runs",
    "walks",
    "hitByPitch",
    "doubles",
    "triples",
    "homeRuns",
    "stolenBases",
    "putOuts",
    "assists",
    "pitchingStrikeouts",
  ];

  const eligiblePlayers = players.filter((p) => !p.leaderboardHidden);
  const out: Partial<LeadersMap> = {};

  for (const k of keys) {
    const eps = isRate(k) ? 0.0005 : 0;
    let max = -Infinity;

    for (const p of eligiblePlayers) {
      if (isRate(k) && !eligibleForRate(p, k)) continue;

      const v = statValue(p, k);
      if (v > max) max = v;
    }

    if (!Number.isFinite(max) || max <= 0) {
      out[k] = [];
      continue;
    }

    out[k] = eligiblePlayers
      .filter((p) => {
        if (isRate(k) && !eligibleForRate(p, k)) return false;

        const v = statValue(p, k);
        return eps > 0 ? near(v, max, eps) : v === max;
      })
      .map((p) => p.id);
  }

  return out as LeadersMap;
}
