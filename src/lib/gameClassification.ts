// Game classification + official season tallies.
//
// Data model note: a game doc under seasons/{id}/games only exists once a
// game has been played and entered — there is no stored schedule of
// upcoming or postponed fixtures. The season's official schedule is just a
// number (`scheduledGames`). So a make-up game is the one and only record
// of a fixture that was originally postponed: it counts once toward games
// played and never adds to the scheduled total.
//
// Kept free of imports so it can be unit tested with `node --test`.

export type GameType = "regular" | "scrimmage" | "makeup";

export const DEFAULT_GAME_TYPE: GameType = "regular";

export const GAME_TYPE_OPTIONS: Array<[GameType, string]> = [
  ["regular", "Regular Season"],
  ["scrimmage", "Scrimmage"],
  ["makeup", "Make-up Game"],
];

/** Legacy games saved before classification existed are Regular Season. */
export function asGameType(v: unknown): GameType {
  return v === "scrimmage" || v === "makeup" ? v : DEFAULT_GAME_TYPE;
}

export function gameTypeLabel(t: GameType): string {
  return GAME_TYPE_OPTIONS.find(([v]) => v === t)?.[1] ?? "Regular Season";
}

/** Regular-season and make-up games are official; scrimmages are not. */
export function isOfficialGame(t: GameType): boolean {
  return t !== "scrimmage";
}

export type OfficialSeasonTally = {
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
};

export function computeOfficialSeasonTally(
  games: Array<{ result?: unknown; gameType?: unknown }>,
): OfficialSeasonTally {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let gamesPlayed = 0;

  for (const g of games) {
    if (!isOfficialGame(asGameType(g.gameType))) continue;

    gamesPlayed += 1;

    const r = typeof g.result === "string" ? g.result.trim().toUpperCase() : "";
    if (r === "W") wins += 1;
    else if (r === "L") losses += 1;
    else if (r === "T") ties += 1;
  }

  return { wins, losses, ties, gamesPlayed };
}
