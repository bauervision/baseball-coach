// Game Ball picker grouping. A player may receive the Game Ball in any
// number of games; each game still has at most one recipient (the game doc
// holds a single `gameBall` object).
//
// Kept free of imports so it can be unit tested with `node --test`.

type GameBallPlayer = { id: string; name: string; number?: number };

export type GameBallGroups<P extends GameBallPlayer> = {
  /** Players with no Game Ball from any other game. */
  firstTime: P[];
  /** Players already awarded in another game, with their award count. */
  previous: Array<{ player: P; count: number }>;
};

function byNumberThenName(a: GameBallPlayer, b: GameBallPlayer): number {
  const na = Number(a.number ?? 0);
  const nb = Number(b.number ?? 0);
  if (na !== nb) return na - nb;
  return String(a.name).localeCompare(String(b.name));
}

/**
 * Award counts exclude the game being edited, so re-opening a game never
 * counts its own pick against the recipient.
 */
export function groupGameBallPlayers<P extends GameBallPlayer>(
  players: P[],
  savedGames: Array<{ id: string; gameBallPlayerId: string }>,
  editingGameId: string | null,
): GameBallGroups<P> {
  const counts = new Map<string, number>();
  for (const g of savedGames) {
    if (!g.gameBallPlayerId) continue;
    if (editingGameId && g.id === editingGameId) continue;
    counts.set(g.gameBallPlayerId, (counts.get(g.gameBallPlayerId) ?? 0) + 1);
  }

  const sorted = players.slice().sort(byNumberThenName);

  return {
    firstTime: sorted.filter((p) => !counts.has(p.id)),
    previous: sorted
      .filter((p) => counts.has(p.id))
      .map((p) => ({ player: p, count: counts.get(p.id) ?? 0 })),
  };
}
