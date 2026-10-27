// Career history across seasons and teams, keyed by permanent identity.
//
// Pure functions only; Firestore loading lives in playerCareerStats.ts.
//
// A season participation counts toward a player's career only when its link
// to the identity is explicit:
// - the roster doc is `identityStatus: "confirmed"`, or
// - a confirmed roster doc of the same identity lists it in `linkedFrom`
//   (the coach picked that exact prior entry when importing).
// Name matches never link anything.

import type { PlayerBattingStats } from "@/lib/roster";
import { asIdentityStatus, normalizeCareerPlayerId } from "@/lib/playerIdentity";
import type { SeasonPlayerRef } from "@/lib/playerSearch";
import { seasonSortKey } from "@/lib/seasonOrder";

export type ParticipationDoc = {
  seasonId: string;
  seasonPlayerId: string;
  careerPlayerId?: string;
  identityStatus?: unknown;
  linkedFrom?: SeasonPlayerRef[];
  name: string;
  number: number;
  stats: PlayerBattingStats;
  season: {
    teamName: string;
    seasonLabel: string;
    teamId?: string;
    createdAtMs?: number;
    endSeasonMode?: boolean;
    finalAwards?: Record<string, string | undefined>;
    branding?: { primary?: string; secondary?: string };
  };
};

const refKey = (r: SeasonPlayerRef) => `${r.seasonId}/${r.seasonPlayerId}`;

export function normalizeLinkedFrom(value: unknown): SeasonPlayerRef[] {
  if (!Array.isArray(value)) return [];
  const out: SeasonPlayerRef[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const d = v as Record<string, unknown>;
    if (
      typeof d.seasonId === "string" &&
      d.seasonId &&
      typeof d.seasonPlayerId === "string" &&
      d.seasonPlayerId
    ) {
      out.push({ seasonId: d.seasonId, seasonPlayerId: d.seasonPlayerId });
    }
  }
  return out;
}

/**
 * Returns the participations explicitly linked to the subject's identity,
 * including the subject itself, oldest first. When the subject is an
 * unreviewed legacy entry that no confirmed entry references, only the
 * subject is returned.
 */
export function resolveCareerParticipations(
  subject: ParticipationDoc,
  candidates: ParticipationDoc[],
): ParticipationDoc[] {
  const id = normalizeCareerPlayerId(subject.careerPlayerId);
  const all = new Map<string, ParticipationDoc>();
  for (const c of [subject, ...candidates]) {
    all.set(refKey(c), c);
  }

  if (!id) return [subject];

  const sameIdentity = (d: ParticipationDoc) => {
    const did = normalizeCareerPlayerId(d.careerPlayerId);
    return did === id || did === undefined;
  };

  const confirmed = [...all.values()].filter(
    (d) =>
      normalizeCareerPlayerId(d.careerPlayerId) === id &&
      asIdentityStatus(d.identityStatus) === "confirmed",
  );

  const included = new Map<string, ParticipationDoc>();
  for (const d of confirmed) included.set(refKey(d), d);
  for (const d of confirmed) {
    for (const ref of d.linkedFrom ?? []) {
      const linked = all.get(refKey(ref));
      if (linked && sameIdentity(linked)) included.set(refKey(linked), linked);
    }
  }

  const subjectKey = refKey(subject);
  if (!included.has(subjectKey)) return [subject];

  // At most one participation per season: a season roster holds a player once.
  const perSeason = new Map<string, ParticipationDoc>();
  for (const d of included.values()) {
    if (d.seasonId === subject.seasonId && refKey(d) !== subjectKey) continue;
    if (!perSeason.has(d.seasonId)) perSeason.set(d.seasonId, d);
  }

  return [...perSeason.values()].sort(
    (a, b) =>
      seasonSortKey(a.season.seasonLabel, a.season.createdAtMs) -
      seasonSortKey(b.season.seasonLabel, b.season.createdAtMs),
  );
}

const SUMMED_KEYS: Array<keyof PlayerBattingStats> = [
  "games",
  "plateAppearances",
  "atBats",
  "hits",
  "doubles",
  "triples",
  "homeRuns",
  "runs",
  "rbi",
  "walks",
  "hitByPitch",
  "stolenBases",
  "putOuts",
  "assists",
  "pitchingStrikeouts",
  "pitchingSaves",
  "flyBallCatches",
  "charlieHustleAwards",
  "mostImprovedAwards",
  "bestPitcherAwards",
  "bestCatcherAwards",
  "bestFirstBasemanAwards",
  "bestSecondBasemanAwards",
  "bestThirdBasemanAwards",
  "bestShortstopAwards",
  "bestLeftFielderAwards",
  "bestCenterFielderAwards",
  "bestRightFielderAwards",
];

function clean(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.floor(v))
    : 0;
}

/** Sums season totals. Streaks do not carry across seasons. */
export function aggregateCareerStats(
  participations: ParticipationDoc[],
): PlayerBattingStats {
  const totals = Object.fromEntries(
    [...SUMMED_KEYS, "currentHitStreak", "longestHitStreak"].map((k) => [k, 0]),
  ) as PlayerBattingStats;

  for (const p of participations) {
    for (const k of SUMMED_KEYS) totals[k] += clean(p.stats[k]);
    totals.longestHitStreak = Math.max(
      totals.longestHitStreak,
      clean(p.stats.longestHitStreak),
    );
  }
  return totals;
}

const FINAL_AWARD_LABELS: Record<string, string> = {
  mvp: "MVP",
  dominator: "Dominator",
  honorableMention: "Honorable Mention",
  bestAllAround: "Best All-Around",
  bestAttitude: "Best Attitude",
};

export type CareerHistoryRow = {
  seasonId: string;
  seasonPlayerId: string;
  teamName: string;
  seasonLabel: string;
  number: number;
  games: number;
  hits: number;
  atBats: number;
  /** Season-specific coach recognition, positive only. */
  recognition: string[];
  accent?: string;
  /** The season's team (cross-team career links on team routes). */
  teamId?: string;
};

export function buildCareerHistoryRows(
  participations: ParticipationDoc[],
): CareerHistoryRow[] {
  return participations.map((p) => {
    const recognition: string[] = [];
    if (p.season.endSeasonMode) {
      for (const [key, label] of Object.entries(FINAL_AWARD_LABELS)) {
        if (p.season.finalAwards?.[key] === p.seasonPlayerId) {
          recognition.push(label);
        }
      }
    }
    const picks =
      clean(p.stats.charlieHustleAwards) +
      clean(p.stats.mostImprovedAwards) +
      clean(p.stats.bestPitcherAwards) +
      clean(p.stats.bestCatcherAwards) +
      clean(p.stats.bestFirstBasemanAwards) +
      clean(p.stats.bestSecondBasemanAwards) +
      clean(p.stats.bestThirdBasemanAwards) +
      clean(p.stats.bestShortstopAwards) +
      clean(p.stats.bestLeftFielderAwards) +
      clean(p.stats.bestCenterFielderAwards) +
      clean(p.stats.bestRightFielderAwards);
    if (picks > 0) {
      recognition.push(`${picks} coach pick${picks === 1 ? "" : "s"}`);
    }

    return {
      seasonId: p.seasonId,
      seasonPlayerId: p.seasonPlayerId,
      teamName: p.season.teamName,
      seasonLabel: p.season.seasonLabel,
      number: p.number,
      games: clean(p.stats.games),
      hits: clean(p.stats.hits),
      atBats: clean(p.stats.atBats),
      recognition,
      accent: p.season.branding?.primary,
      ...(p.season.teamId ? { teamId: p.season.teamId } : {}),
    };
  });
}
