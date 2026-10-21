// Returning-player candidates and fuzzy search for roster import.
//
// Pure functions only; Firestore loading lives in rosterImportStore.ts.

import {
  asIdentityStatus,
  normalizeCareerPlayerId,
  normalizePersonName,
  type IdentityStatus,
} from "@/lib/playerIdentity";
import { seasonSortKey } from "@/lib/seasonOrder";

export type SeasonPlayerRef = { seasonId: string; seasonPlayerId: string };

export type RosterSeasonInput = {
  seasonId: string;
  teamName: string;
  seasonLabel: string;
  teamId?: string;
  /** Coaches who manage this season. Absent on legacy single-team seasons. */
  coachUids?: string[];
  createdAtMs?: number;
  players: Array<{
    id: string;
    name: string;
    number: number;
    careerPlayerId?: string;
    identityStatus?: unknown;
    linkedFrom?: SeasonPlayerRef[];
  }>;
};

export type CandidateSeason = SeasonPlayerRef & {
  teamName: string;
  seasonLabel: string;
  teamId?: string;
  number: number;
  sortKey: number;
};

export type PlayerCandidate = {
  /** Unique key for UI selection. */
  key: string;
  /** Identity the imported roster entry will reference. Empty = mint new. */
  careerPlayerId: string;
  displayName: string;
  /** Every name this player has been rostered under (renames). */
  names: string[];
  status: IdentityStatus;
  /** Most recent first. */
  seasons: CandidateSeason[];
  /** Coach-linked child (from the private registry). */
  linkedChild?: boolean;
};

/**
 * A season is visible to a coach when it lists them in `coachUids`. Legacy
 * seasons without `coachUids` predate multi-coach support and belong to the
 * single allowlisted admin group, so any admin may see them.
 */
export function seasonVisibleToCoach(
  season: Pick<RosterSeasonInput, "coachUids">,
  uid: string,
): boolean {
  const coaches = season.coachUids;
  if (!coaches || coaches.length === 0) return true;
  return !!uid && coaches.includes(uid);
}

/**
 * Builds import candidates from prior rosters. Confirmed participations that
 * share a careerPlayerId are one candidate. Unreviewed legacy entries are
 * never grouped with anything, even when their name or careerPlayerId
 * matches another entry: those links were made by name matching and stay
 * unresolved until a coach reviews them.
 */
export function buildCandidatesFromRosters(
  seasons: RosterSeasonInput[],
  opts: { uid: string; excludeSeasonId?: string },
): PlayerCandidate[] {
  const byKey = new Map<string, PlayerCandidate>();

  for (const season of seasons) {
    if (season.seasonId === opts.excludeSeasonId) continue;
    if (!seasonVisibleToCoach(season, opts.uid)) continue;

    const sortKey = seasonSortKey(season.seasonLabel, season.createdAtMs);

    for (const p of season.players) {
      const name = p.name.trim();
      if (!name) continue;

      const careerPlayerId = normalizeCareerPlayerId(p.careerPlayerId) ?? "";
      const status = asIdentityStatus(p.identityStatus);
      const key =
        status === "confirmed" && careerPlayerId
          ? `id:${careerPlayerId}`
          : `legacy:${season.seasonId}/${p.id}`;

      const entry: CandidateSeason = {
        seasonId: season.seasonId,
        seasonPlayerId: p.id,
        teamName: season.teamName,
        seasonLabel: season.seasonLabel,
        teamId: season.teamId,
        number: p.number,
        sortKey,
      };

      const existing = byKey.get(key);
      if (existing) {
        existing.seasons.push(entry);
        if (!existing.names.includes(name)) existing.names.push(name);
        continue;
      }

      byKey.set(key, {
        key,
        careerPlayerId,
        displayName: name,
        names: [name],
        status: key.startsWith("id:") ? "confirmed" : "unreviewed",
        seasons: [entry],
      });
    }
  }

  // A legacy entry that a confirmed entry explicitly links (linkedFrom, set
  // when the coach imported it) belongs to that confirmed identity.
  for (const season of seasons) {
    for (const p of season.players) {
      if (asIdentityStatus(p.identityStatus) !== "confirmed") continue;
      const owner = byKey.get(`id:${normalizeCareerPlayerId(p.careerPlayerId)}`);
      if (!owner) continue;
      for (const ref of p.linkedFrom ?? []) {
        const legacyKey = `legacy:${ref.seasonId}/${ref.seasonPlayerId}`;
        const legacy = byKey.get(legacyKey);
        if (!legacy) continue;
        if (legacy.careerPlayerId && legacy.careerPlayerId !== owner.careerPlayerId) {
          continue;
        }
        owner.seasons.push(...legacy.seasons);
        for (const n of legacy.names) {
          if (!owner.names.includes(n)) owner.names.push(n);
        }
        byKey.delete(legacyKey);
      }
    }
  }

  const out = [...byKey.values()];
  for (const c of out) {
    c.seasons.sort((a, b) => b.sortKey - a.sortKey);
    // Show the name from the most recent season (handles renames).
    const latest = c.seasons[0];
    const latestPlayer = seasons
      .find((s) => s.seasonId === latest.seasonId)
      ?.players.find((p) => p.id === latest.seasonPlayerId);
    if (latestPlayer?.name.trim()) c.displayName = latestPlayer.name.trim();
  }
  return out;
}

/**
 * Adds coach-managed identities from the private registry (for example a
 * linked child who has not played a season yet) and marks linked children.
 */
export function mergeRegistryCandidates(
  candidates: PlayerCandidate[],
  registry: Array<{ careerPlayerId: string; displayName: string }>,
  linkedChildIds: ReadonlySet<string>,
): PlayerCandidate[] {
  const out = candidates.map((c) => ({ ...c }));
  const byId = new Map(
    out.filter((c) => c.status === "confirmed").map((c) => [c.careerPlayerId, c]),
  );

  for (const r of registry) {
    const id = normalizeCareerPlayerId(r.careerPlayerId);
    if (!id) continue;
    const existing = byId.get(id);
    if (existing) {
      if (linkedChildIds.has(id)) existing.linkedChild = true;
      continue;
    }
    const displayName = r.displayName.trim() || "Player";
    const added: PlayerCandidate = {
      key: `id:${id}`,
      careerPlayerId: id,
      displayName,
      names: [displayName],
      status: "confirmed",
      seasons: [],
      linkedChild: linkedChildIds.has(id) || undefined,
    };
    out.push(added);
    byId.set(id, added);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fuzzy search

/** Optimal string alignment distance (Damerau-Levenshtein, adjacent swaps). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array<number>(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

function allowedTypos(length: number): number {
  if (length >= 7) return 2;
  if (length >= 3) return 1;
  return 0;
}

/** Score of one query token against one name token (0 = no match). */
function tokenScore(q: string, t: string): number {
  if (q === t) return 100;
  if (t.startsWith(q)) return 80;
  if (q.length >= 3 && t.includes(q)) return 55;

  const typos = allowedTypos(q.length);
  if (typos === 0) return 0;
  const full = editDistance(q, t);
  if (full <= typos) return 70 - full * 10;
  // Typo inside a prefix the coach is still typing: "jonh" → "johnathan".
  if (t.length > q.length) {
    const prefix = editDistance(q, t.slice(0, q.length));
    if (prefix <= typos) return 45 - prefix * 10;
  }
  return 0;
}

/**
 * Scores a name against a query. Every query token must match some name
 * token; returns 0 when the name does not match.
 */
export function scoreName(query: string, name: string): number {
  const qTokens = normalizePersonName(query).split(" ").filter(Boolean);
  const nTokens = normalizePersonName(name).split(" ").filter(Boolean);
  if (qTokens.length === 0 || nTokens.length === 0) return 0;

  let total = 0;
  for (const q of qTokens) {
    let best = 0;
    for (const t of nTokens) best = Math.max(best, tokenScore(q, t));
    if (best === 0) return 0;
    total += best;
  }

  let score = total / qTokens.length;
  // Whole-name matches rank above token matches.
  const qFull = qTokens.join(" ");
  const nFull = nTokens.join(" ");
  if (qFull === nFull) score += 30;
  else if (nFull.startsWith(qFull)) score += 10;
  return score;
}

export type CandidateResult = PlayerCandidate & {
  score: number;
  /** Extra detail shown when another result has the same name. */
  disambiguation: string | null;
};

function seasonSummary(c: PlayerCandidate): string {
  const latest = c.seasons[0];
  if (!latest) return "No confirmed seasons yet";
  const num = latest.number > 0 ? `#${latest.number} · ` : "";
  return `${num}${latest.teamName} ${latest.seasonLabel}`;
}

/**
 * Ranks candidates for a query. An empty query lists everyone (linked
 * children first, then most recent season, then name).
 */
export function searchCandidates(
  candidates: PlayerCandidate[],
  query: string,
): CandidateResult[] {
  const q = query.trim();
  const scored = candidates
    .map((c) => ({
      c,
      score: q
        ? Math.max(0, ...[c.displayName, ...c.names].map((n) => scoreName(q, n)))
        : 1,
    }))
    .filter((r) => r.score > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const la = a.c.linkedChild ? 1 : 0;
    const lb = b.c.linkedChild ? 1 : 0;
    if (lb !== la) return lb - la;
    const ra = a.c.seasons[0]?.sortKey ?? -Infinity;
    const rb = b.c.seasons[0]?.sortKey ?? -Infinity;
    if (rb !== ra) return rb - ra;
    return a.c.displayName.localeCompare(b.c.displayName);
  });

  const nameCounts = new Map<string, number>();
  for (const c of candidates) {
    const n = normalizePersonName(c.displayName);
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }

  return scored.map(({ c, score }) => {
    const dup = (nameCounts.get(normalizePersonName(c.displayName)) ?? 0) > 1;
    return {
      ...c,
      score,
      disambiguation: dup ? seasonSummary(c) : null,
    };
  });
}

/**
 * Linked children are preselected for a new roster unless already on it.
 * This is a default only; the coach can deselect before submitting.
 */
export function defaultSelectedKeys(
  candidates: PlayerCandidate[],
  isOnRoster: (c: PlayerCandidate) => boolean,
): string[] {
  return candidates.filter((c) => c.linkedChild && !isOnRoster(c)).map((c) => c.key);
}
