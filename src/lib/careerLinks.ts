// Public career links (multi-coach data model). Pure functions only.
//
// After the public/private split, roster entries no longer carry
// careerPlayerId/identityStatus/linkedFrom publicly. Each public entry has
// `careerLinks: [{seasonId, seasonPlayerId}]` instead: exactly the other
// seasons the app's career view shows for it (resolveCareerParticipations),
// restricted to seasons parents may see. Same algorithm as careerLinksFor in
// tools/privacy-split-migrate.mjs (kept equal by tests/careerLinks.test.mjs),
// with "visible" meaning published.

import type { SeasonPlayerRef } from "@/lib/playerSearch";

export type CareerLinkEntry = {
  seasonId: string;
  seasonPlayerId: string;
  /** Effective identity fields (private profile, or legacy public fields). */
  careerPlayerId?: string;
  confirmed: boolean;
  linkedFrom: SeasonPlayerRef[];
};

export const MAX_CAREER_LINKS = 25;

const keyOf = (r: { seasonId?: string; seasonPlayerId?: string }) => `${r.seasonId}/${r.seasonPlayerId}`;

/** Links per entry key ("seasonId/seasonPlayerId"), sorted by key. */
export function computeCareerLinks(
  entries: CareerLinkEntry[],
  visibleSeasonIds: ReadonlySet<string>,
): Map<string, SeasonPlayerRef[]> {
  const byKey = new Map(entries.map((e) => [keyOf(e), e]));
  const out = new Map<string, SeasonPlayerRef[]>();
  for (const subject of entries) {
    const subjectKey = keyOf(subject);
    const id = subject.careerPlayerId?.trim() || undefined;
    if (!id) {
      out.set(subjectKey, []);
      continue;
    }
    const all = new Map<string, CareerLinkEntry>([[subjectKey, subject]]);
    for (const e of entries) if (e.careerPlayerId?.trim() === id) all.set(keyOf(e), e);
    for (const c of [...all.values()]) {
      for (const r of c.linkedFrom) {
        const t = byKey.get(keyOf(r));
        if (t) all.set(keyOf(r), t);
      }
    }
    const confirmed = [...all.values()].filter((d) => d.careerPlayerId?.trim() === id && d.confirmed);
    const included = new Map(confirmed.map((d) => [keyOf(d), d]));
    for (const d of confirmed) {
      for (const r of d.linkedFrom) {
        const linked = all.get(keyOf(r));
        const lid = linked?.careerPlayerId?.trim() || undefined;
        if (linked && (lid === id || lid === undefined)) included.set(keyOf(linked), linked);
      }
    }
    if (!included.has(subjectKey)) {
      out.set(subjectKey, []);
      continue;
    }
    const perSeason = new Map<string, CareerLinkEntry>();
    for (const d of included.values()) {
      if (d.seasonId === subject.seasonId && keyOf(d) !== subjectKey) continue;
      if (!perSeason.has(d.seasonId)) perSeason.set(d.seasonId, d);
    }
    out.set(
      subjectKey,
      [...perSeason.values()]
        .filter((d) => keyOf(d) !== subjectKey && visibleSeasonIds.has(d.seasonId))
        .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
        .slice(0, MAX_CAREER_LINKS)
        .map((d) => ({ seasonId: d.seasonId, seasonPlayerId: d.seasonPlayerId })),
    );
  }
  return out;
}

/** Public careerLinks field value as stored (validated shape). */
export function normalizeCareerLinks(value: unknown): SeasonPlayerRef[] {
  if (!Array.isArray(value)) return [];
  const out: SeasonPlayerRef[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const d = v as Record<string, unknown>;
    if (typeof d.seasonId === "string" && d.seasonId && typeof d.seasonPlayerId === "string" && d.seasonPlayerId) {
      out.push({ seasonId: d.seasonId, seasonPlayerId: d.seasonPlayerId });
    }
  }
  return out;
}

export function sameLinks(a: SeasonPlayerRef[], b: SeasonPlayerRef[]): boolean {
  return a.length === b.length && a.every((x, i) => keyOf(x) === keyOf(b[i]));
}
