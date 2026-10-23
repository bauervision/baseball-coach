import {
  collection,
  getDocs,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import type { RosterSeasonInput } from "@/lib/playerSearch";
import { normalizeLinkedFrom } from "@/lib/careerHistory";
import { seasonSortKey } from "@/lib/seasonOrder";
import { normalizeSeasonMeta } from "@/lib/rosterStore";
import type { LifecycleEvent, SeasonStatus } from "@/lib/seasonLifecycle";
import type { SeasonBranding } from "@/lib/branding";

export type SeasonSummary = {
  seasonId: string;
  teamName: string;
  seasonLabel: string;
  teamId?: string;
  coachUids?: string[];
  createdAtMs?: number;
  gamesPlayed: number;
  /** Lifecycle status; null for seasons created before lifecycle support. */
  status: SeasonStatus | null;
  endSeasonMode: boolean;
  record: { wins: number; losses: number; ties?: number };
  finalAwardsChosen: number;
  layoutsSaved: number;
  /** Append-only audit of finalize/reopen/activate, oldest first. */
  lifecycleHistory: LifecycleEvent[];
  /** The season's own branding snapshot; null for legacy seasons. */
  branding: SeasonBranding | null;
};

/**
 * Season doc -> summary. Team name and label use the same normalization as
 * the season views (normalizeSeasonMeta), so selectors, admin, and pages
 * always agree, including for legacy docs saved without those fields.
 */
export function seasonSummaryFromData(
  seasonId: string,
  data: DocumentData,
): SeasonSummary {
  const meta = normalizeSeasonMeta(data);
  const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
  const coachUids = Array.isArray(data.coachUids)
    ? (data.coachUids as unknown[]).filter(
        (u): u is string => typeof u === "string" && !!u,
      )
    : undefined;
  return {
    seasonId,
    teamName: meta.teamName,
    seasonLabel: meta.seasonLabel,
    teamId: typeof data.teamId === "string" ? data.teamId : undefined,
    coachUids,
    createdAtMs:
      typeof createdAt?.toMillis === "function" ? createdAt.toMillis() : undefined,
    gamesPlayed: meta.gamesPlayed,
    status: meta.status,
    endSeasonMode: meta.endSeasonMode,
    record: meta.record,
    finalAwardsChosen: Object.values(meta.finalAwards).filter(Boolean).length,
    layoutsSaved: Object.keys(meta.recognitionLayouts).length,
    lifecycleHistory: Array.isArray(data.lifecycleHistory)
      ? (data.lifecycleHistory as LifecycleEvent[])
      : [],
    branding: meta.hasBrandingSnapshot ? meta.branding : null,
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
