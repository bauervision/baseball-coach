// Unsaved-edit tracking for the Stat Update form. The "baseline" is the
// form as last loaded or successfully saved; anything that differs from it
// is unsaved. Saving always persists the whole game, so every dirty player
// is included in the next save no matter which row's Save Data was clicked.
//
// Kept free of runtime imports so it can be unit tested with `node --test`.

type Deltas = Record<string, number>;
type LinesLike = Record<string, { delta: Deltas }>;

function sameDelta(a: Deltas | undefined, b: Deltas | undefined): boolean {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    if ((a?.[k] ?? 0) !== (b?.[k] ?? 0)) return false;
  }
  return true;
}

/** Players whose stat line differs from the baseline. */
export function dirtyPlayerIds(
  lines: LinesLike,
  baseline: LinesLike,
): Set<string> {
  const out = new Set<string>();
  for (const [id, line] of Object.entries(lines)) {
    if (!sameDelta(line.delta, baseline[id]?.delta)) out.add(id);
  }
  return out;
}

export type GameFormSnapshot = {
  lines: LinesLike;
  coachPicks: Record<string, string>;
  gameBallPlayerId: string;
  gameType: string;
  date: string;
  opponent: string;
  result: string;
  scoreUs: string;
  scoreThem: string;
};

/** True when any game field, pick, or stat line differs from the baseline. */
export function hasUnsavedGameChanges(
  current: GameFormSnapshot,
  baseline: GameFormSnapshot,
): boolean {
  if (dirtyPlayerIds(current.lines, baseline.lines).size > 0) return true;

  const scalarKeys = [
    "gameBallPlayerId",
    "gameType",
    "date",
    "opponent",
    "result",
  ] as const;
  for (const k of scalarKeys) {
    if (current[k] !== baseline[k]) return true;
  }

  // Scores are compared numerically so "" vs "0" mid-edit isn't a change.
  const n = (s: string) => Number.parseInt(s.trim() || "0", 10) || 0;
  if (n(current.scoreUs) !== n(baseline.scoreUs)) return true;
  if (n(current.scoreThem) !== n(baseline.scoreThem)) return true;

  const pickKeys = new Set([
    ...Object.keys(current.coachPicks),
    ...Object.keys(baseline.coachPicks),
  ]);
  for (const k of pickKeys) {
    if ((current.coachPicks[k] ?? "") !== (baseline.coachPicks[k] ?? "")) {
      return true;
    }
  }

  return false;
}
