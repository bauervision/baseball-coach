// lib/roster.ts

export type PlayerBattingStats = {
  games: number;
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  runs: number;
  rbi: number;
  walks: number;
  strikeouts: number;
  hitByPitch: number;
  // Defensive
  putOuts: number;
  assists: number;
};

export type Player = {
  id: string;
  name: string;
  number: number;
  primaryPos?: string;
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
  // Baseball formatting: show .000 style by removing leading 0
  const s = n.toFixed(3);
  return s.startsWith("0") ? s.slice(1) : s;
}

export type StatKey =
  | "avg"
  | "obp"
  | "slg"
  | "ops"
  | "hits"
  | "atBats"
  | "rbi"
  | "runs";

export type LeadersMap = Record<StatKey, string[]>;

function near(a: number, b: number, eps: number) {
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
    case "atBats":
      return p.stats.atBats;
    case "rbi":
      return p.stats.rbi;
    case "runs":
      return p.stats.runs;
  }
}

function isRate(k: StatKey) {
  return k === "avg" || k === "obp" || k === "slg" || k === "ops";
}

function isCounting(k: StatKey) {
  return !isRate(k);
}

function eligibleForRate(p: Player, k: StatKey): boolean {
  const s = p.stats;

  // AVG/SLG/OPS need AB > 0.
  if (k === "avg" || k === "slg" || k === "ops") return s.atBats > 0;

  // OBP denominator uses AB+BB+HBP.
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
    "atBats",
    "rbi",
    "runs",
  ];

  const out: Partial<LeadersMap> = {};

  for (const k of keys) {
    const eps = isRate(k) ? 0.0005 : 0;

    // Find max among eligible players
    let max = -Infinity;
    for (const p of players) {
      if (isRate(k) && !eligibleForRate(p, k)) continue;
      const v = statValue(p, k);
      if (v > max) max = v;
    }

    // If nobody is eligible, or max is not meaningful, no leaders.
    if (!Number.isFinite(max)) {
      out[k] = [];
      continue;
    }

    // For counting stats: if max is 0, nobody "leads".
    if (isCounting(k) && max <= 0) {
      out[k] = [];
      continue;
    }

    // For rate stats: if max is 0, also don't show leaders (everyone is 0.000).
    if (isRate(k) && max <= 0) {
      out[k] = [];
      continue;
    }

    const leaders: string[] = [];
    for (const p of players) {
      if (isRate(k) && !eligibleForRate(p, k)) continue;

      const v = statValue(p, k);
      const isLeader = eps > 0 ? near(v, max, eps) : v === max;
      if (isLeader) leaders.push(p.id);
    }

    out[k] = leaders;
  }

  return out as LeadersMap;
}