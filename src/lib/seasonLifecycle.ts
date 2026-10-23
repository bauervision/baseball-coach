// Season lifecycle: draft → active → finalized (→ reopened = active).
//
// `status` is a durable field on seasons/{seasonId}. Seasons created before
// lifecycle support have no status: they stay editable ("legacy") and are
// never treated as finalized, even when their old end-of-season flag
// (`endSeasonMode`) is set. Finalizing them is an explicit coach action.
//
// Which season the coach administers (app/config.currentSeasonId) is a
// separate concept from status, and from the season a viewer is browsing.
//
// Pure functions only; Firestore writes live in the admin actions and are
// enforced by firestore.rules.

export type SeasonStatus = "draft" | "active" | "finalized";

export type LifecycleEvent = {
  action: "finalized" | "reopened" | "activated";
  /** ISO time (client clock; serverTimestamp is not allowed in arrays). */
  at: string;
  byUid: string;
  fromStatus: SeasonStatus | "legacy";
  previousFinalizedAt?: string | null;
  previousFinalizedByUid?: string | null;
};

export function asSeasonStatus(value: unknown): SeasonStatus | null {
  return value === "draft" || value === "active" || value === "finalized"
    ? value
    : null;
}

export function isFinalized(data: { status?: unknown } | null | undefined): boolean {
  return asSeasonStatus(data?.status) === "finalized";
}

export function isWritable(data: { status?: unknown } | null | undefined): boolean {
  return !isFinalized(data);
}

/** Short status tag for selectors; null when nothing needs saying. */
export function seasonTag(opts: {
  status: SeasonStatus | null;
  isCurrent: boolean;
  endSeasonMode?: boolean;
}): "Current" | "Final" | "Draft" | "Ended" | null {
  if (opts.status === "finalized") return "Final";
  if (opts.isCurrent) return "Current";
  if (opts.status === "draft") return "Draft";
  if (opts.endSeasonMode) return "Ended";
  return null;
}

/** Drafts are setup-in-progress and are not shown to parents. */
export function visibleToViewers(opts: {
  status: SeasonStatus | null;
  isCurrent: boolean;
}): boolean {
  return opts.status !== "draft" || opts.isCurrent;
}

export type FinalizationFacts = {
  seasonLabel: string;
  teamName: string;
  officialGames: number;
  record: { wins: number; losses: number; ties?: number };
  rosterSize: number;
  finalAwardsChosen: number;
  layoutsSaved: number;
};

export type ChecklistItem = { key: string; label: string; fact: string };

export function finalizationChecklist(f: FinalizationFacts): ChecklistItem[] {
  const rec = `${f.record.wins}-${f.record.losses}${f.record.ties ? `-${f.record.ties}` : ""}`;
  return [
    { key: "games", label: "Games and record reviewed", fact: `${f.officialGames} official games · ${rec}` },
    { key: "roster", label: "Roster reviewed", fact: `${f.rosterSize} players` },
    {
      key: "awards",
      label: "Final awards selected or skipped",
      fact: f.finalAwardsChosen ? `${f.finalAwardsChosen} chosen` : "none chosen",
    },
    {
      key: "layouts",
      label: "Recognition layouts reviewed",
      fact: f.layoutsSaved ? `${f.layoutsSaved} saved arrangements` : "automatic arrangements",
    },
    { key: "identity", label: "Season name and label confirmed", fact: `${f.teamName} · ${f.seasonLabel}` },
  ];
}

const LIFECYCLE_KEYS = new Set([
  "status",
  "finalizedAt",
  "finalizedByUid",
  "reopenedAt",
  "reopenedByUid",
  "activatedAt",
  "lifecycleHistory",
  "updatedAt",
]);

/** Keys a lifecycle transition may write (mirrors firestore.rules). */
export function isLifecycleOnlyUpdate(keys: string[]): boolean {
  return keys.every((k) => LIFECYCLE_KEYS.has(k));
}

function history(data: Record<string, unknown>): LifecycleEvent[] {
  return Array.isArray(data.lifecycleHistory)
    ? (data.lifecycleHistory as LifecycleEvent[])
    : [];
}

function iso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  const t = v as { toDate?: () => Date };
  return typeof t.toDate === "function" ? t.toDate().toISOString() : null;
}

/**
 * Plans finalization. Idempotent: an already-finalized season yields no
 * write. Only lifecycle fields change; stats, record, games played, awards,
 * and layouts are untouched.
 */
export function planFinalize(
  data: Record<string, unknown>,
  uid: string,
  nowIso: string,
):
  | { alreadyFinalized: true }
  | { alreadyFinalized: false; event: LifecycleEvent; history: LifecycleEvent[] } {
  if (isFinalized(data)) return { alreadyFinalized: true };
  if (!uid) throw new Error("Sign in as the head coach to finalize.");
  const event: LifecycleEvent = {
    action: "finalized",
    at: nowIso,
    byUid: uid,
    fromStatus: asSeasonStatus(data.status) ?? "legacy",
  };
  return { alreadyFinalized: false, event, history: [...history(data), event] };
}

/**
 * Plans reopening a finalized season back to "active" (editable). Does not
 * make it the current season. The previous finalization stays in history.
 */
export function planReopen(
  data: Record<string, unknown>,
  uid: string,
  nowIso: string,
): { event: LifecycleEvent; history: LifecycleEvent[] } {
  if (!isFinalized(data)) throw new Error("Only a finalized season can be reopened.");
  if (!uid) throw new Error("Sign in as the head coach to reopen.");
  const event: LifecycleEvent = {
    action: "reopened",
    at: nowIso,
    byUid: uid,
    fromStatus: "finalized",
    previousFinalizedAt: iso(data.finalizedAt),
    previousFinalizedByUid: typeof data.finalizedByUid === "string" ? data.finalizedByUid : null,
  };
  return { event, history: [...history(data), event] };
}
