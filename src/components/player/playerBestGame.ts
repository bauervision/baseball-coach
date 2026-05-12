export type PlayerGameLogItemForBestGame = {
  gameId: string;
  date: string;
  opponent: string;
  result: "W" | "L" | "T";
  scoreUs: number;
  scoreThem: number;
  delta: {
    atBats: number;
    hits: number;
    runs: number;
    rbi: number;
    walks: number;
    hitByPitch: number;
  };
};

export type PlayerBestGame = PlayerGameLogItemForBestGame & {
  lineSummary: string;
  score: number;
};

function lineSummary(item: PlayerGameLogItemForBestGame): string {
  const bits: string[] = [];

  bits.push(`${item.delta.hits} for ${item.delta.atBats}`);

  if (item.delta.runs > 0) {
    bits.push(`${item.delta.runs} ${item.delta.runs === 1 ? "run" : "runs"}`);
  }

  if (item.delta.rbi > 0) {
    bits.push(`${item.delta.rbi} RBI`);
  }

  if (item.delta.walks > 0) {
    bits.push(`${item.delta.walks} BB`);
  }

  if (item.delta.hitByPitch > 0) {
    bits.push(`${item.delta.hitByPitch} HBP`);
  }

  return bits.join(" • ");
}

function bestGameScore(item: PlayerGameLogItemForBestGame): number {
  return (
    item.delta.hits * 6 +
    item.delta.rbi * 4 +
    item.delta.runs * 3 +
    item.delta.walks * 2 +
    item.delta.hitByPitch * 2 +
    item.delta.atBats
  );
}

export function pickPlayerBestGame(
  items: PlayerGameLogItemForBestGame[] | null | undefined,
): PlayerBestGame | null {
  if (!items || items.length === 0) return null;

  const scored = items
    .map((item): PlayerBestGame => ({
      ...item,
      lineSummary: lineSummary(item),
      score: bestGameScore(item),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.delta.hits !== a.delta.hits) return b.delta.hits - a.delta.hits;
      if (b.delta.rbi !== a.delta.rbi) return b.delta.rbi - a.delta.rbi;
      return a.date.localeCompare(b.date);
    });

  return scored[0] ?? null;
}
