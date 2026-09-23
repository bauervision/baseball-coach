import type { Player } from "@/lib/roster";

export const LINEUP_POSITIONS = [
  "",
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "CF",
  "LF",
  "LCF",
  "RCF",
  "RF",
  "BENCH",
] as const;

export type LineupPosition = (typeof LINEUP_POSITIONS)[number];

export type LineupPlayerRow = {
  playerId: string;
  battingOrder: number;
  innings: Record<string, LineupPosition>;
};

export type SavedLineup = {
  id: string;
  title: string;
  seasonId: string;
  createdAtISO: string;
  updatedAtISO: string;
  inningCount: number;
  rows: LineupPlayerRow[];
};

// A frozen copy of a lineup captured at the moment a game was first saved.
// Unlike SavedLineup (which tracks the mutable "current" lineup), this is
// historical data attached to a specific game and must never change after
// the fact just because the current lineup changes later.
export type GameLineupSnapshot = {
  capturedAtISO: string;
  inningCount: number;
  rows: LineupPlayerRow[];
};

export type LineupValidationIssue = {
  inning: string;
  position: LineupPosition;
  playerIds: string[];
};

export function createEmptyLineupRows(
  players: Player[],
  inningCount = 6,
): LineupPlayerRow[] {
  return players.map((p, index) => {
    const innings: Record<string, LineupPosition> = {};

    for (let i = 1; i <= inningCount; i += 1) {
      innings[String(i)] = "";
    }

    return {
      playerId: p.id,
      battingOrder: index + 1,
      innings,
    };
  });
}

export function benchCount(row: LineupPlayerRow): number {
  return Object.values(row.innings).filter((pos) => pos === "BENCH").length;
}

export function validateLineup(
  rows: LineupPlayerRow[],
): LineupValidationIssue[] {
  const issues: LineupValidationIssue[] = [];
  const inningKeys = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row.innings))),
  ).sort((a, b) => Number(a) - Number(b));

  for (const inning of inningKeys) {
    const byPosition = new Map<LineupPosition, string[]>();

    for (const row of rows) {
      const position = row.innings[inning];
      if (!position || position === "BENCH") continue;

      const next = byPosition.get(position) ?? [];
      next.push(row.playerId);
      byPosition.set(position, next);
    }

    for (const [position, playerIds] of byPosition.entries()) {
      if (playerIds.length > 1) {
        issues.push({ inning, position, playerIds });
      }
    }
  }

  return issues;
}

export function playerNameById(players: Player[], playerId: string): string {
  return players.find((p) => p.id === playerId)?.name ?? "Unknown Player";
}

export function sortLineupRows(rows: LineupPlayerRow[]): LineupPlayerRow[] {
  return [...rows].sort((a, b) => a.battingOrder - b.battingOrder);
}

// Orders players to match a lineup's batting order. Players with no row in
// the lineup (e.g. added after the lineup was built) keep their existing
// relative order and are placed after everyone who has a batting position.
export function orderPlayersByLineup<T extends { id: string }>(
  players: T[],
  lineupRows: Array<Pick<LineupPlayerRow, "playerId" | "battingOrder">>
    | null
    | undefined,
): T[] {
  if (!lineupRows || lineupRows.length === 0) return players;

  const orderByPlayerId = new Map<string, number>();
  for (const row of lineupRows) {
    if (!orderByPlayerId.has(row.playerId)) {
      orderByPlayerId.set(row.playerId, row.battingOrder);
    }
  }

  return [...players].sort((a, b) => {
    const orderA = orderByPlayerId.get(a.id);
    const orderB = orderByPlayerId.get(b.id);

    if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
    if (orderA !== undefined) return -1;
    if (orderB !== undefined) return 1;
    return 0;
  });
}
