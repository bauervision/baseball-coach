// Coach-assigned recognition for a single game: the Game Ball plus any
// Coach Choices. Games persist only the pick key (e.g. "bestShortstop"), so
// the titles here are the single source for both the admin picker and the
// player Game Log — the parent sees exactly the title the coach selected.
//
// Kept free of imports so it can be unit tested with `node --test`.

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

export const COACH_PICK_FIELDS: ReadonlyArray<{
  key: CoachPickKey;
  label: string;
}> = [
  { key: "charlieHustle", label: "Charlie Hustle" },
  { key: "mostImproved", label: "Most Improved" },
  { key: "bestPitcher", label: "Best Pitcher" },
  { key: "bestCatcher", label: "Best Catcher" },
  { key: "bestFirstBaseman", label: "Best 1B" },
  { key: "bestSecondBaseman", label: "Best 2B" },
  { key: "bestThirdBaseman", label: "Best 3B" },
  { key: "bestShortstop", label: "Best SS" },
  { key: "bestLeftFielder", label: "Best LF" },
  { key: "bestCenterFielder", label: "Best CF" },
  { key: "bestRightFielder", label: "Best RF" },
];

export const GAME_BALL_TITLE = "Game Ball";

export type GameRecognition = {
  /** "gameBall" or the persisted coach pick key. */
  key: string;
  title: string;
  isGameBall: boolean;
};

function awardPlayerId(v: unknown): string {
  return v &&
    typeof v === "object" &&
    typeof (v as { playerId?: unknown }).playerId === "string"
    ? (v as { playerId: string }).playerId
    : "";
}

/** Readable fallback for a pick key this build doesn't know yet. */
function titleFromKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key;
}

/**
 * Every recognition `playerId` received in one game: Game Ball first, then
 * Coach Choices in the admin picker's order. Missing or malformed award
 * fields (legacy games) simply yield no recognition.
 */
export function recognitionsForPlayer(
  gameData: { gameBall?: unknown; coachAwards?: unknown },
  playerId: string,
): GameRecognition[] {
  if (!playerId) return [];
  const out: GameRecognition[] = [];

  if (awardPlayerId(gameData.gameBall) === playerId) {
    out.push({ key: "gameBall", title: GAME_BALL_TITLE, isGameBall: true });
  }

  const awards =
    gameData.coachAwards && typeof gameData.coachAwards === "object"
      ? (gameData.coachAwards as Record<string, unknown>)
      : {};

  const known = new Set<string>();
  for (const { key, label } of COACH_PICK_FIELDS) {
    known.add(key);
    if (awardPlayerId(awards[key]) === playerId) {
      out.push({ key, title: label, isGameBall: false });
    }
  }

  for (const [key, award] of Object.entries(awards)) {
    if (known.has(key) || awardPlayerId(award) !== playerId) continue;
    out.push({ key, title: titleFromKey(key), isGameBall: false });
  }

  return out;
}
