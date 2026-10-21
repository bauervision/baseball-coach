import {
  collection,
  getDocs,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import type { RosterSeasonInput } from "@/lib/playerSearch";
import { normalizeLinkedFrom } from "@/lib/careerHistory";
import { seasonSortKey } from "@/lib/seasonOrder";

export type SeasonSummary = {
  seasonId: string;
  teamName: string;
  seasonLabel: string;
  teamId?: string;
  coachUids?: string[];
  createdAtMs?: number;
  gamesPlayed: number;
};

export function seasonSummaryFromData(
  seasonId: string,
  data: DocumentData,
): SeasonSummary {
  const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
  const coachUids = Array.isArray(data.coachUids)
    ? (data.coachUids as unknown[]).filter(
        (u): u is string => typeof u === "string" && !!u,
      )
    : undefined;
  return {
    seasonId,
    teamName:
      typeof data.teamName === "string" && data.teamName.trim()
        ? data.teamName.trim()
        : "Team",
    seasonLabel:
      typeof data.seasonLabel === "string" && data.seasonLabel.trim()
        ? data.seasonLabel.trim()
        : seasonId,
    teamId: typeof data.teamId === "string" ? data.teamId : undefined,
    coachUids,
    createdAtMs:
      typeof createdAt?.toMillis === "function" ? createdAt.toMillis() : undefined,
    gamesPlayed:
      typeof data.gamesPlayed === "number" ? Math.max(0, data.gamesPlayed) : 0,
  };
}

/** All seasons, most recent first. */
export async function listSeasons(db: Firestore): Promise<SeasonSummary[]> {
  const snap = await getDocs(collection(db, "seasons"));
  return snap.docs
    .map((d) => seasonSummaryFromData(d.id, d.data()))
    .sort(
      (a, b) =>
        seasonSortKey(b.seasonLabel, b.createdAtMs) -
        seasonSortKey(a.seasonLabel, a.createdAtMs),
    );
}

/** Prior rosters for the returning-player picker. */
export async function loadRosterSeasons(
  db: Firestore,
  seasons: SeasonSummary[],
): Promise<RosterSeasonInput[]> {
  return Promise.all(
    seasons.map(async (s) => {
      const players = await getDocs(collection(db, "seasons", s.seasonId, "players"));
      return {
        ...s,
        players: players.docs.map((p) => {
          const d = p.data();
          return {
            id: p.id,
            name: typeof d.name === "string" ? d.name : "",
            number: typeof d.number === "number" ? d.number : 0,
            careerPlayerId:
              typeof d.careerPlayerId === "string" ? d.careerPlayerId : undefined,
            identityStatus: d.identityStatus,
            linkedFrom: normalizeLinkedFrom(d.linkedFrom),
          };
        }),
      };
    }),
  );
}
