import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import type { Player, PlayerBattingStats } from "@/lib/roster";
import { EMPTY_STATS } from "@/lib/roster";
import {
  aggregateCareerStats,
  buildCareerHistoryRows,
  normalizeLinkedFrom,
  resolveCareerParticipations,
  type CareerHistoryRow,
  type ParticipationDoc,
} from "@/lib/careerHistory";

type SeasonInfo = ParticipationDoc["season"];

function seasonInfo(data: DocumentData | undefined): SeasonInfo {
  const d = (data ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;
  const createdAt = d.createdAt as { toMillis?: () => number } | undefined;
  const finalAwards =
    d.finalAwards && typeof d.finalAwards === "object"
      ? (d.finalAwards as Record<string, string | undefined>)
      : undefined;
  const branding =
    d.branding && typeof d.branding === "object"
      ? (d.branding as { primary?: string; secondary?: string })
      : undefined;
  return {
    teamName: str(d.teamName, "Team"),
    seasonLabel: str(d.seasonLabel, "Season"),
    teamId: typeof d.teamId === "string" ? d.teamId : undefined,
    createdAtMs:
      typeof createdAt?.toMillis === "function" ? createdAt.toMillis() : undefined,
    endSeasonMode: d.endSeasonMode === true,
    finalAwards,
    branding,
  };
}

function statsOf(v: unknown): PlayerBattingStats {
  const d = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out = { ...EMPTY_STATS };
  for (const k of Object.keys(out) as Array<keyof PlayerBattingStats>) {
    const n = d[k];
    if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function participation(
  seasonId: string,
  seasonPlayerId: string,
  data: DocumentData,
  season: SeasonInfo,
): ParticipationDoc {
  return {
    seasonId,
    seasonPlayerId,
    careerPlayerId:
      typeof data.careerPlayerId === "string" ? data.careerPlayerId : undefined,
    identityStatus: data.identityStatus,
    linkedFrom: normalizeLinkedFrom(data.linkedFrom),
    name: typeof data.name === "string" ? data.name : "",
    number: typeof data.number === "number" ? data.number : 0,
    stats: statsOf(data.stats),
    season,
  };
}

export type CareerSummary = {
  /** Explicitly linked seasons, oldest first, including the current one. */
  history: CareerHistoryRow[];
  totals: PlayerBattingStats;
};

/**
 * Loads a player's career by permanent identity only. Prior seasons are
 * found by `careerPlayerId` equality and counted only when the link is
 * explicit (see careerHistory.ts). Names are never compared.
 */
export async function loadCareerSummary(opts: {
  db: Firestore;
  seasonId: string;
  player: Player;
  currentSeason: SeasonInfo;
}): Promise<CareerSummary> {
  const { db, seasonId, player, currentSeason } = opts;

  const subject: ParticipationDoc = {
    seasonId,
    seasonPlayerId: player.id,
    careerPlayerId: player.careerPlayerId,
    identityStatus: player.identityStatus,
    linkedFrom: player.linkedFrom ?? [],
    name: player.name,
    number: player.number,
    stats: player.stats,
    season: currentSeason,
  };

  const candidates: ParticipationDoc[] = [];
  const seen = new Set<string>([`${seasonId}/${player.id}`]);
  const seasonCache = new Map<string, SeasonInfo>([[seasonId, currentSeason]]);

  if (player.careerPlayerId) {
    const seasonsSnap = await getDocs(collection(db, "seasons"));
    for (const s of seasonsSnap.docs) {
      seasonCache.set(s.id, seasonInfo(s.data()));
      if (s.id === seasonId) continue;
      const matches = await getDocs(
        query(
          collection(db, "seasons", s.id, "players"),
          where("careerPlayerId", "==", player.careerPlayerId),
        ),
      );
      for (const m of matches.docs) {
        seen.add(`${s.id}/${m.id}`);
        candidates.push(participation(s.id, m.id, m.data(), seasonCache.get(s.id)!));
      }
    }
  }

  // Follow explicit linkedFrom references (one level is enough: every
  // import records all of the entries the coach linked).
  const refs = [subject, ...candidates].flatMap((c) => c.linkedFrom ?? []);
  for (const ref of refs) {
    const key = `${ref.seasonId}/${ref.seasonPlayerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const snap = await getDoc(
      doc(db, "seasons", ref.seasonId, "players", ref.seasonPlayerId),
    );
    if (!snap.exists()) continue;
    let season = seasonCache.get(ref.seasonId);
    if (!season) {
      season = seasonInfo((await getDoc(doc(db, "seasons", ref.seasonId))).data());
      seasonCache.set(ref.seasonId, season);
    }
    candidates.push(participation(ref.seasonId, snap.id, snap.data(), season));
  }

  const included = resolveCareerParticipations(subject, candidates);
  return {
    history: buildCareerHistoryRows(included),
    totals: aggregateCareerStats(included),
  };
}
