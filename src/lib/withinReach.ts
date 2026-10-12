// "Within reach" indicators for the player page's season stat cards: a
// gentle "N behind leader" shown only when a player is genuinely close to
// the team leader. Leaders come from the same computeLeaders() result that
// drives the LEAD badge, so scope (leaderboard-hidden players excluded) and
// tie handling are identical.
//
// Kept free of imports so it can be unit tested with `node --test`.

/**
 * Max gap (inclusive) at which the indicator shows, per count stat.
 * Deliberately absent: games played, plate appearances, at-bats, rate
 * stats (AVG/OBP/SLG/OPS), hit by pitch (not an accomplishment), and
 * saves / fly-ball catches (no LEAD calculation exists for them).
 */
export const WITHIN_REACH_THRESHOLDS = {
  hits: 2,
  runs: 2,
  rbi: 2,
  walks: 2,
  doubles: 1,
  triples: 1,
  homeRuns: 1,
  longestHitStreak: 1,
  stolenBases: 3,
  putOuts: 3,
  assists: 3,
  pitchingStrikeouts: 3,
} as const;

export type WithinReachKey = keyof typeof WITHIN_REACH_THRESHOLDS;

type RosterPlayer = {
  id: string;
  leaderboardHidden?: boolean;
  stats: Partial<Record<WithinReachKey, unknown>>;
};

function countValue(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * Gap to the leader (1..threshold) or null when no indicator should show:
 * the player leads or ties, has 0, is outside the threshold, the stat isn't
 * eligible, or the leader value can't be determined reliably.
 */
export function behindLeaderGap(opts: {
  key: string;
  playerValue: unknown;
  leaderValue: unknown;
}): number | null {
  if (!(opts.key in WITHIN_REACH_THRESHOLDS)) return null;
  const threshold = WITHIN_REACH_THRESHOLDS[opts.key as WithinReachKey];

  const mine = countValue(opts.playerValue);
  const lead = countValue(opts.leaderValue);
  if (mine === null || lead === null || mine <= 0) return null;

  const gap = lead - mine;
  return gap >= 1 && gap <= threshold ? gap : null;
}

/**
 * Indicators for one player across every eligible stat, from the roster and
 * the LEAD map (`leaders[key]` = leader ids). Leaders must all share one
 * valid value, or the stat is skipped.
 */
export function computeWithinReach(
  players: RosterPlayer[],
  playerId: string,
  leaders: Partial<Record<string, string[]>>,
): Partial<Record<WithinReachKey, number>> {
  const out: Partial<Record<WithinReachKey, number>> = {};
  const me = players.find((p) => p.id === playerId);
  // Leaderboard-hidden players are outside the LEAD scope entirely.
  if (!me || me.leaderboardHidden) return out;

  for (const key of Object.keys(WITHIN_REACH_THRESHOLDS) as WithinReachKey[]) {
    const leaderIds = leaders[key];
    if (!Array.isArray(leaderIds) || leaderIds.length === 0) continue;
    if (leaderIds.includes(playerId)) continue;

    const leaderValues = new Set<number | null>();
    for (const id of leaderIds) {
      const p = players.find((x) => x.id === id);
      leaderValues.add(p && !p.leaderboardHidden ? countValue(p.stats[key]) : null);
    }
    if (leaderValues.size !== 1 || leaderValues.has(null)) continue;
    const [leaderValue] = [...leaderValues];

    const gap = behindLeaderGap({
      key,
      playerValue: me.stats[key],
      leaderValue,
    });
    if (gap !== null) out[key] = gap;
  }

  return out;
}

export function behindLeaderText(gap: number): string {
  return `${gap} behind leader`;
}

/** 1 behind is warm and emphasized; 2–3 behind stay quiet. */
export function behindLeaderTone(gap: number): "emphasis" | "neutral" {
  return gap === 1 ? "emphasis" : "neutral";
}
