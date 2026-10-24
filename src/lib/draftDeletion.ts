// Draft season deletion: who may be deleted, and why not.
//
// Only an unused draft may be deleted: status exactly "draft" (or
// "deleting", an interrupted deletion being resumed), not the current
// season, and with nothing recorded. firestore.rules mirror the season-doc
// checks (seasonDocBlockers) on the draft → deleting lock and forbid games,
// lines, lineups, and other records on drafts; the roster check below runs
// after the lock, when the roster can no longer change. Anything this file
// does not recognise blocks deletion (fail closed).
//
// Pure functions only; the deletion itself is deleteDraftSeason in
// src/app/(protected)/admin/_parts/adminActions.ts.

/** Final award keys the app writes; anything else blocks deletion. */
export const FINAL_AWARD_KEYS = ["mvp", "dominator", "honorableMention", "bestAllAround", "bestAttitude"] as const;

/** Season-doc reasons a season cannot be deleted (empty: eligible). */
export function seasonDocBlockers(
  data: Record<string, unknown> | null | undefined,
  opts: { isCurrent: boolean },
): string[] {
  if (!data) return ["The season does not exist."];
  const out: string[] = [];
  const status = data.status;
  if (status === undefined || status === null) {
    out.push("Seasons created before drafts existed cannot be deleted.");
  } else if (status !== "draft" && status !== "deleting") {
    out.push(status === "finalized" ? "Finalized seasons cannot be deleted." : "Only draft seasons can be deleted.");
  }
  if (opts.isCurrent) out.push("The current season cannot be deleted.");
  if (data.endSeasonMode === true) out.push("The season has ended.");
  if (typeof data.gamesPlayed === "number" && data.gamesPlayed !== 0) out.push("The season has games played.");
  const record = (data.record ?? {}) as Record<string, unknown>;
  if (["wins", "losses", "ties"].some((k) => record[k] !== undefined && record[k] !== 0)) {
    out.push("The season has a win-loss record.");
  }
  if (Object.keys(data).some((k) => k.startsWith("record."))) out.push("The season has a legacy record.");
  const layouts = data.recognitionLayouts;
  if (layouts && typeof layouts === "object" && Object.keys(layouts).length > 0) {
    out.push("The season has saved recognition layouts.");
  }
  const awards = data.finalAwards;
  if (awards !== undefined && awards !== null) {
    if (typeof awards !== "object") out.push("The season has final awards.");
    else {
      const a = awards as Record<string, unknown>;
      const unknown = Object.keys(a).some((k) => !(FINAL_AWARD_KEYS as readonly string[]).includes(k));
      if (unknown || Object.values(a).some((v) => v !== "" && v !== null && v !== undefined)) {
        out.push("The season has final awards.");
      }
    }
  }
  return out;
}

/** Fields a draft roster entry may carry; anything else blocks deletion. */
const ROSTER_FIELDS = new Set([
  "id", "name", "number", "careerPlayerId", "identityStatus", "linkedFrom", "returningPlayer",
  "leaderboardHidden", "primaryPos", "shirtSize", "bats", "throws", "stats", "createdAt", "updatedAt",
]);

/** Roster reasons (stats or awards already recorded on a draft entry). */
export function rosterBlockers(players: Array<{ id: string; data: Record<string, unknown> }>): string[] {
  const out: string[] = [];
  for (const p of players) {
    const extra = Object.keys(p.data).filter((k) => !ROSTER_FIELDS.has(k));
    if (extra.length) {
      out.push(`Roster entry ${p.id} has unrecognised data (${extra.join(", ")}).`);
      continue;
    }
    const stats = p.data.stats;
    if (stats !== undefined && (typeof stats !== "object" || stats === null)) {
      out.push(`Roster entry ${p.id} has unrecognised stats.`);
      continue;
    }
    const recorded = Object.entries((stats ?? {}) as Record<string, unknown>).some(([, v]) => v !== 0);
    if (recorded) out.push(`Roster entry ${p.id} has recorded stats or awards.`);
  }
  return out;
}

/** Firestore batch size used for roster deletes (limit is 500 writes). */
export const DELETE_BATCH = 400;
