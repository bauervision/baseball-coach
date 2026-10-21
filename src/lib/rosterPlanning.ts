// Non-destructive roster planning: season creation checks, returning-player
// imports, new players, and the one permitted destructive roster action
// (removing a player who has no history).
//
// Pure functions only; Firestore writes live in the admin actions.

import { EMPTY_STATS, type Player } from "@/lib/roster";
import {
  normalizeCareerPlayerId,
  normalizePersonName,
} from "@/lib/playerIdentity";
import type { SeasonPlayerRef } from "@/lib/playerSearch";

// ---------------------------------------------------------------------------
// Seasons

const SEASON_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function validateNewSeasonId(
  raw: string,
  existingSeasonIds: Iterable<string>,
): { ok: true; seasonId: string } | { ok: false; error: string } {
  const seasonId = raw.trim().toLowerCase();
  if (!seasonId) return { ok: false, error: "Season id is required." };
  if (!SEASON_ID_PATTERN.test(seasonId)) {
    return {
      ok: false,
      error:
        "Season id may use lowercase letters, numbers, and dashes (for example tigers-spring-2027).",
    };
  }
  for (const id of existingSeasonIds) {
    if (id.trim().toLowerCase() === seasonId) {
      return {
        ok: false,
        error: `Season "${seasonId}" already exists. Choose it under Make current season instead.`,
      };
    }
  }
  return { ok: true, seasonId };
}

// ---------------------------------------------------------------------------
// Roster additions

export type RosterEntryDetails = {
  number: string;
  primaryPos: string;
  shirtSize: string;
};

export type ImportSelection = RosterEntryDetails & {
  careerPlayerId: string;
  name: string;
  /** Prior roster entries the coach explicitly picked for this player. */
  linkedFrom: SeasonPlayerRef[];
};

export type NewPlayerDraft = RosterEntryDetails & {
  careerPlayerId: string;
  name: string;
};

export type ExistingRosterEntry = Pick<Player, "id" | "name" | "number"> & {
  careerPlayerId?: string;
  linkedFrom?: SeasonPlayerRef[];
};

export type RosterWrite = {
  seasonPlayerId: string;
  kind: "returning" | "new";
  data: {
    id: string;
    careerPlayerId: string;
    identityStatus: "confirmed";
    name: string;
    number: number;
    primaryPos?: string;
    shirtSize: string | null;
    leaderboardHidden: boolean;
    returningPlayer: boolean;
    linkedFrom: SeasonPlayerRef[];
    stats: typeof EMPTY_STATS;
  };
};

export type RosterAdditionPlan = {
  writes: RosterWrite[];
  skipped: Array<{ name: string; reason: "already-on-roster" | "duplicate" }>;
  warnings: string[];
};

const SHIRT_SIZES = new Set([
  "YXS",
  "YS",
  "YM",
  "YL",
  "YXL",
  "AS",
  "AM",
  "AL",
  "AXL",
]);

function parseNumber(s: string): number {
  const n = Number(s.trim());
  return s.trim() && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * Plans additions to a season roster. Never deletes or overwrites: a player
 * whose identity (or a prior entry they were imported from) is already on the
 * roster is skipped, which makes repeated submissions idempotent. New
 * entries use the permanent careerPlayerId as their roster doc id, so the id
 * never encodes a name or jersey number. Stats start at zero for the season.
 */
export function planRosterAdditions(opts: {
  existing: ExistingRosterEntry[];
  imports: ImportSelection[];
  newPlayers: NewPlayerDraft[];
}): RosterAdditionPlan {
  const plan: RosterAdditionPlan = { writes: [], skipped: [], warnings: [] };

  const onRosterIds = new Set<string>();
  const onRosterRefs = new Set<string>();
  const numbers = new Map<number, string>();
  for (const e of opts.existing) {
    onRosterIds.add(e.id);
    const cid = normalizeCareerPlayerId(e.careerPlayerId);
    if (cid) onRosterIds.add(cid);
    for (const r of e.linkedFrom ?? []) {
      onRosterRefs.add(`${r.seasonId}/${r.seasonPlayerId}`);
    }
    if (e.number > 0) numbers.set(e.number, e.name);
  }

  const plannedIds = new Set<string>();

  const add = (
    entry: RosterEntryDetails & { careerPlayerId: string; name: string },
    kind: RosterWrite["kind"],
    linkedFrom: SeasonPlayerRef[],
  ) => {
    const name = entry.name.trim();
    const careerPlayerId = normalizeCareerPlayerId(entry.careerPlayerId);
    if (!name) return;
    if (!careerPlayerId) {
      throw new Error(`Missing permanent player id for ${name}.`);
    }

    const alreadyOnRoster =
      onRosterIds.has(careerPlayerId) ||
      linkedFrom.some((r) => onRosterRefs.has(`${r.seasonId}/${r.seasonPlayerId}`));
    if (alreadyOnRoster) {
      plan.skipped.push({ name, reason: "already-on-roster" });
      return;
    }
    if (plannedIds.has(careerPlayerId)) {
      plan.skipped.push({ name, reason: "duplicate" });
      return;
    }
    plannedIds.add(careerPlayerId);

    const number = parseNumber(entry.number);
    if (number > 0) {
      const holder = numbers.get(number);
      if (holder) {
        plan.warnings.push(`#${number} is shared by ${holder} and ${name}.`);
      } else {
        numbers.set(number, name);
      }
    }

    const shirt = entry.shirtSize.trim().toUpperCase();
    const primaryPos = entry.primaryPos.trim();

    plan.writes.push({
      seasonPlayerId: careerPlayerId,
      kind,
      data: {
        id: careerPlayerId,
        careerPlayerId,
        identityStatus: "confirmed",
        name,
        number,
        ...(primaryPos ? { primaryPos } : {}),
        shirtSize: SHIRT_SIZES.has(shirt) ? shirt : null,
        leaderboardHidden: false,
        returningPlayer: kind === "returning",
        linkedFrom,
        stats: { ...EMPTY_STATS },
      },
    });
  };

  for (const s of opts.imports) add(s, "returning", s.linkedFrom);
  for (const n of opts.newPlayers) add(n, "new", []);

  // Gentle heads-up only; same names are allowed and never merged.
  const seen = new Map<string, number>();
  for (const e of opts.existing) {
    const n = normalizePersonName(e.name);
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  for (const w of plan.writes) {
    const n = normalizePersonName(w.data.name);
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    if (count === 2) {
      plan.warnings.push(
        `Two players named ${w.data.name} — they stay separate players.`,
      );
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Removal (the only permitted destructive roster action)

export type SeasonReferenceScan = {
  /** Player ids with at least one game line. */
  lineIds: Iterable<string>;
  /** Player ids named in game coach awards or Game Ball. */
  gameAwardIds: Iterable<string>;
  /** Player ids named in season final awards. */
  finalAwardIds: Iterable<string>;
  /** Player ids with a saved recognition layout. */
  layoutIds: Iterable<string>;
  /** Player ids referenced by later seasons' linkedFrom. */
  linkedFromIds?: Iterable<string>;
};

/**
 * Returns why a roster entry may not be removed, or null when it has no
 * history at all. Players with any history are kept forever.
 */
export function rosterRemovalBlocker(
  seasonPlayerId: string,
  scan: SeasonReferenceScan,
): string | null {
  const has = (ids: Iterable<string> | undefined) =>
    !!ids && [...ids].includes(seasonPlayerId);
  if (has(scan.lineIds)) return "has game stats";
  if (has(scan.gameAwardIds)) return "has game recognition";
  if (has(scan.finalAwardIds)) return "has a season award";
  if (has(scan.layoutIds)) return "has a saved recognition layout";
  if (has(scan.linkedFromIds)) return "is linked from a later season";
  return null;
}
