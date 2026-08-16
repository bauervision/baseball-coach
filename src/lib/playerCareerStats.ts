import {
  collection,
  doc,
  getDoc,
  getDocs,
  type Firestore,
} from "firebase/firestore";
import type { PlayerBattingStats } from "@/lib/roster";

const STAT_KEYS = Object.keys({
  games: 0,
  plateAppearances: 0,
  atBats: 0,
  hits: 0,
  currentHitStreak: 0,
  longestHitStreak: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  runs: 0,
  rbi: 0,
  walks: 0,
  hitByPitch: 0,
  stolenBases: 0,
  putOuts: 0,
  assists: 0,
  pitchingStrikeouts: 0,
  pitchingSaves: 0,
  flyBallCatches: 0,
  charlieHustleAwards: 0,
  mostImprovedAwards: 0,
  bestPitcherAwards: 0,
  bestCatcherAwards: 0,
  bestFirstBasemanAwards: 0,
  bestSecondBasemanAwards: 0,
  bestThirdBasemanAwards: 0,
  bestShortstopAwards: 0,
  bestLeftFielderAwards: 0,
  bestCenterFielderAwards: 0,
  bestRightFielderAwards: 0,
}) as Array<keyof PlayerBattingStats>;

export async function loadCareerStats(opts: {
  db: Firestore;
  playerId: string;
  careerPlayerId?: string;
  playerName: string;
  currentSeasonId: string;
  currentStats: PlayerBattingStats;
}): Promise<PlayerBattingStats> {
  const {
    db,
    playerId,
    careerPlayerId,
    playerName,
    currentSeasonId,
    currentStats,
  } = opts;
  const totals: PlayerBattingStats = { ...currentStats };
  const seasonsSnap = await getDocs(collection(db, "seasons"));
  const normalizedName = playerName.trim().toLowerCase();

  for (const seasonDoc of seasonsSnap.docs) {
    if (seasonDoc.id === currentSeasonId) continue;

    const playerSnapById = await getDoc(
      doc(db, "seasons", seasonDoc.id, "players", playerId),
    );
    let playerSnap = playerSnapById;

    if (normalizedName) {
      const playersSnap = await getDocs(
        collection(db, "seasons", seasonDoc.id, "players"),
      );
      const matchingPlayer = playersSnap.docs.find((candidate) => {
        const data = candidate.data();
        const name = data.name;
        const candidateCareerId = data.careerPlayerId;
        return (
          (typeof careerPlayerId === "string" &&
            candidateCareerId === careerPlayerId) ||
          (typeof name === "string" &&
            name.trim().toLowerCase() === normalizedName)
        );
      });

      if (matchingPlayer && !playerSnapById.exists())
        playerSnap = matchingPlayer;
    }

    if (!playerSnap.exists()) continue;

    const stats = playerSnap.data().stats;
    if (!stats || typeof stats !== "object") continue;

    const seasonStats = stats as Record<string, unknown>;
    for (const key of STAT_KEYS) {
      const value = seasonStats[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        const normalized = Math.max(0, Math.floor(value));
        if (key === "currentHitStreak") continue;
        if (key === "longestHitStreak") {
          totals[key] = Math.max(totals[key], normalized);
        } else {
          totals[key] += normalized;
        }
      }
    }
  }

  return totals;
}
