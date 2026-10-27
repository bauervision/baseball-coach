// lib/rosterStore.ts
"use client";

import * as React from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  type Unsubscribe,
  type Firestore,
  type QuerySnapshot,
  type DocumentData,
} from "firebase/firestore";
import { getFirestoreDb } from "@/lib/firebase.client";
import type { Player, PlayerBattingStats } from "@/lib/roster";
import { normalizeSavedOrder } from "@/lib/recognitionLayout";
import { asIdentityStatus } from "@/lib/playerIdentity";
import { normalizeLinkedFrom } from "@/lib/careerHistory";
import { normalizeCareerLinks } from "@/lib/careerLinks";
import { useTeamScope } from "@/lib/teamScopeContext";
import { useAdminScope } from "@/lib/adminScope";
import { asSeasonStatus, type SeasonStatus } from "@/lib/seasonLifecycle";
import {
  LEGACY_TIGERS_BRANDING,
  normalizeBranding,
  type SeasonBranding,
} from "@/lib/branding";

/**
 * Fallback if app/config is missing.
 * Keep this as a safe default so the app still works locally.
 */
export const DEFAULT_SEASON_ID = "tigers-2026";

export type RosterFinalAwards = {
  mvp?: string;
  dominator?: string;
  honorableMention?: string;
  bestAllAround?: string;
  bestAttitude?: string;
};

export type RosterMeta = {
  teamName: string;
  seasonLabel: string;
  league: string;
  record: { wins: number; losses: number; ties?: number };
  usesGamesPlayedRecord: boolean;
  scheduledGames: number;
  gamesPlayed: number;
  endSeasonMode: boolean;
  finalAwards: RosterFinalAwards;
  /** Coach-saved recognition sheet award order, keyed by player id. */
  recognitionLayouts: Record<string, string[]>;
  /** Lifecycle status; null for seasons created before lifecycle support. */
  status: SeasonStatus | null;
  /**
   * The season's branding snapshot, or the legacy Tigers branding for
   * seasons saved before snapshots existed (deterministic).
   */
  branding: SeasonBranding;
  hasBrandingSnapshot: boolean;
};

const DEFAULT_META: RosterMeta = {
  teamName: "Tigers",
  seasonLabel: "Spring 2026",
  league: "Mustang",
  record: { wins: 0, losses: 0 },
  usesGamesPlayedRecord: false,
  scheduledGames: 0,
  gamesPlayed: 0,
  endSeasonMode: false,
  finalAwards: {},
  recognitionLayouts: {},
  status: null,
  branding: LEGACY_TIGERS_BRANDING,
  hasBrandingSnapshot: false,
};

function asNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function asInt(v: unknown): number {
  const n = asNum(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function asNonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length ? v.trim() : undefined;
}

function normalizeFinalAwards(v: unknown): RosterFinalAwards {
  const d = v && typeof v === "object" ? (v as Record<string, unknown>) : {};

  return {
    mvp: asNonEmptyString(d.mvp),
    dominator: asNonEmptyString(d.dominator),
    honorableMention: asNonEmptyString(d.honorableMention),
    bestAllAround: asNonEmptyString(d.bestAllAround),
    bestAttitude: asNonEmptyString(d.bestAttitude),
  };
}

function normalizeRecognitionLayouts(
  v: unknown,
): RosterMeta["recognitionLayouts"] {
  const d = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out: RosterMeta["recognitionLayouts"] = {};

  for (const [playerId, layout] of Object.entries(d)) {
    const order = normalizeSavedOrder(
      layout && typeof layout === "object"
        ? (layout as { order?: unknown }).order
        : undefined,
    );
    if (order) out[playerId] = order;
  }

  return out;
}

function normalizeRecord(v: unknown): RosterMeta["record"] {
  const d =
    v && typeof v === "object"
      ? (v as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const wins = asInt(d.wins);
  const losses = asInt(d.losses);

  const tiesRaw = d.ties;
  const ties =
    typeof tiesRaw === "number" && Number.isFinite(tiesRaw)
      ? Math.floor(tiesRaw)
      : undefined;

  return typeof ties === "number" ? { wins, losses, ties } : { wins, losses };
}

/** Season doc -> display metadata (shared by every season view). */
export function normalizeSeasonMeta(v: unknown): RosterMeta {
  return normalizeMeta(v);
}

function normalizeMeta(v: unknown): RosterMeta {
  const d =
    v && typeof v === "object"
      ? (v as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const snapshot = normalizeBranding(d.branding);

  return {
    teamName:
      asNonEmptyString(d.teamName) ?? snapshot?.teamName ?? DEFAULT_META.teamName,
    seasonLabel: asNonEmptyString(d.seasonLabel) ?? DEFAULT_META.seasonLabel,
    // Branded seasons use their own division (possibly blank); the
    // "Mustang" default applies only to legacy seasons.
    league:
      asNonEmptyString(d.league) ?? (snapshot ? snapshot.division : DEFAULT_META.league),
    record: normalizeRecord(d.record),
    usesGamesPlayedRecord: d.usesGamesPlayedRecord === true,
    scheduledGames: Math.max(0, asInt(d.scheduledGames)),
    gamesPlayed: Math.max(0, asInt(d.gamesPlayed)),
    endSeasonMode: d.endSeasonMode === true,
    finalAwards: normalizeFinalAwards(d.finalAwards),
    recognitionLayouts: normalizeRecognitionLayouts(d.recognitionLayouts),
    status: asSeasonStatus(d.status),
    branding: snapshot ?? LEGACY_TIGERS_BRANDING,
    hasBrandingSnapshot: snapshot !== null,
  };
}

function normalizeStats(v: unknown): PlayerBattingStats {
  const d =
    v && typeof v === "object"
      ? (v as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  return {
    games: asInt(d.games),
    plateAppearances: asInt(d.plateAppearances),
    atBats: asInt(d.atBats),
    hits: asInt(d.hits),
    currentHitStreak: asInt(d.currentHitStreak),
    longestHitStreak: asInt(d.longestHitStreak),
    doubles: asInt(d.doubles),
    triples: asInt(d.triples),
    homeRuns: asInt(d.homeRuns),
    runs: asInt(d.runs),
    rbi: asInt(d.rbi),
    walks: asInt(d.walks),
    pitchingStrikeouts: asInt(d.pitchingStrikeouts),
    hitByPitch: asInt(d.hitByPitch),

    putOuts: asInt(d.putOuts),
    assists: asInt(d.assists),
    stolenBases: asInt(d.stolenBases),
    pitchingSaves: asInt(d.pitchingSaves),
    flyBallCatches: asInt(d.flyBallCatches),

    charlieHustleAwards: asInt(d.charlieHustleAwards),
    mostImprovedAwards: asInt(d.mostImprovedAwards),
    bestPitcherAwards: asInt(d.bestPitcherAwards),
    bestCatcherAwards: asInt(d.bestCatcherAwards),
    bestFirstBasemanAwards: asInt(d.bestFirstBasemanAwards),
    bestSecondBasemanAwards: asInt(d.bestSecondBasemanAwards),
    bestThirdBasemanAwards: asInt(d.bestThirdBasemanAwards),
    bestShortstopAwards: asInt(d.bestShortstopAwards),
    bestLeftFielderAwards: asInt(d.bestLeftFielderAwards),
    bestCenterFielderAwards: asInt(d.bestCenterFielderAwards),
    bestRightFielderAwards: asInt(d.bestRightFielderAwards),
  };
}

function normalizePlayer(data: unknown, fallbackId: string): Player | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  const id = typeof d.id === "string" && d.id ? d.id : fallbackId;
  const careerPlayerId = asNonEmptyString(d.careerPlayerId);
  const name = typeof d.name === "string" ? d.name.trim() : "";
  const number = asInt(d.number);

  if (!name) return null;

  const primaryPos = asNonEmptyString(d.primaryPos);
  const leaderboardHidden = d.leaderboardHidden === true;
  const returningPlayer = d.returningPlayer === true;

  const allowed = new Set([
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

  const shirtSize =
    typeof d.shirtSize === "string" && allowed.has(d.shirtSize.trim())
      ? (d.shirtSize.trim() as Player["shirtSize"])
      : null;

  const p: Player = {
    id,
    careerPlayerId,
    name,
    number,
    shirtSize,
    leaderboardHidden,
    returningPlayer,
    identityStatus: asIdentityStatus(d.identityStatus),
    stats: normalizeStats(d.stats),
  };

  if (primaryPos) p.primaryPos = primaryPos;
  const linkedFrom = normalizeLinkedFrom(d.linkedFrom);
  if (linkedFrom.length) p.linkedFrom = linkedFrom;
  const careerLinks = normalizeCareerLinks(d.careerLinks);
  if (careerLinks.length) p.careerLinks = careerLinks;

  return p;
}

function readCurrentSeasonIdFromConfigData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const v = d.currentSeasonId;
  if (typeof v === "string" && v.trim().length) return v.trim();
  return null;
}

function configDoc(db: Firestore) {
  // Doc: app/config
  return doc(db, "app", "config");
}

function seasonDoc(db: Firestore, seasonId: string) {
  // Doc: seasons/{seasonId}
  return doc(db, "seasons", seasonId);
}

function playersQuery(db: Firestore, seasonId: string) {
  // Collection: seasons/{seasonId}/players
  return query(collection(db, "seasons", seasonId, "players"));
}

type RosterSnapshot = {
  /** The season this snapshot shows (viewed season, or the active one). */
  seasonId: string;
  /** app/config.currentSeasonId: the coach's administrative season. */
  activeSeasonId: string;
  meta: RosterMeta;
  /** The season doc has been read (meta is real, not the default). */
  loaded: boolean;
  players: Player[] | null;
  error: string | null;
};

/**
 * Requested-season value meaning "no season": team routes that have not
 * resolved (or have nothing published) must never follow app/config.
 */
export const NO_SEASON = "__none__"; // reserved Firestore id form: never a real season

type Subscriber = {
  /** Requested season, or null to follow the active season. */
  requested: string | null;
  cb: (snap: RosterSnapshot) => void;
  sid: string | null;
};

type SeasonWatch = {
  meta: RosterMeta;
  loaded: boolean;
  players: Player[] | null;
  error: string | null;
  unsubs: Unsubscribe[];
  subs: Set<Subscriber>;
  teardownTimer: ReturnType<typeof setTimeout> | null;
};

const TEARDOWN_MS = 300;

/**
 * Shared Firestore watchers that survive route transitions.
 *
 * One config watcher tracks the active season. Each season being shown
 * (active or historical) has its own refcounted watcher, so a historical
 * page and the active-season shell never mix data, and two views of the
 * same season share one subscription. Teardown is delayed slightly so
 * navigation does not thrash listeners (which can trigger Firestore
 * internal assertion crashes in some SDK versions).
 */
class RosterWatchManager {
  private db: Firestore | null = null;

  private activeSeasonId: string | null = null;
  private configError: string | null = null;
  private configUnsub: Unsubscribe | null = null;
  private configTeardown: ReturnType<typeof setTimeout> | null = null;

  private subscribers = new Set<Subscriber>();
  private seasons = new Map<string, SeasonWatch>();

  private ensureDb(): Firestore {
    if (!this.db) this.db = getFirestoreDb();
    return this.db;
  }

  subscribe(
    requested: string | null,
    cb: (snap: RosterSnapshot) => void,
  ): Unsubscribe {
    const sub: Subscriber = { requested, cb, sid: null };
    this.subscribers.add(sub);
    // Only "follow the active season" subscribers need app/config.
    if (requested === null) this.ensureConfig();
    this.route(sub);
    this.push(sub);

    return () => {
      this.subscribers.delete(sub);
      if (sub.sid) this.release(sub.sid, sub);
      if (![...this.subscribers].some((s) => s.requested === null)) this.scheduleConfigTeardown();
    };
  }

  private route(sub: Subscriber): void {
    const next = sub.requested === NO_SEASON ? null : sub.requested ?? this.activeSeasonId;
    if (next === sub.sid) return;
    if (sub.sid) this.release(sub.sid, sub);
    sub.sid = next;
    if (next) this.acquire(next, sub);
  }

  private push(sub: Subscriber): void {
    const w = sub.sid ? this.seasons.get(sub.sid) : undefined;
    sub.cb({
      seasonId: sub.sid ?? "",
      activeSeasonId: this.activeSeasonId ?? "",
      meta: w?.meta ?? DEFAULT_META,
      loaded: w?.loaded ?? false,
      players: w?.players ?? null,
      error: w?.error ?? (sub.requested === null ? this.configError : null),
    });
  }

  private emitSeason(seasonId: string): void {
    for (const sub of this.seasons.get(seasonId)?.subs ?? []) this.push(sub);
  }

  private ensureConfig(): void {
    if (this.configTeardown) {
      clearTimeout(this.configTeardown);
      this.configTeardown = null;
    }
    if (this.configUnsub) return;

    this.configUnsub = onSnapshot(
      configDoc(this.ensureDb()),
      (cfgSnap) => {
        const sid =
          (cfgSnap.exists()
            ? readCurrentSeasonIdFromConfigData(cfgSnap.data())
            : null) ?? DEFAULT_SEASON_ID;
        this.setActive(sid, null);
      },
      (e) =>
        this.setActive(DEFAULT_SEASON_ID, e?.message ?? "Failed to load app config."),
    );
  }

  private setActive(sid: string, error: string | null): void {
    this.configError = error;
    const changed = sid !== this.activeSeasonId;
    this.activeSeasonId = sid;
    for (const sub of this.subscribers) {
      if (changed && sub.requested === null) this.route(sub);
      this.push(sub);
    }
  }

  private scheduleConfigTeardown(): void {
    if (this.configTeardown) return;
    this.configTeardown = setTimeout(() => {
      this.configTeardown = null;
      if ([...this.subscribers].some((s) => s.requested === null)) return;
      this.configUnsub?.();
      this.configUnsub = null;
      this.activeSeasonId = null;
    }, TEARDOWN_MS);
  }

  private acquire(seasonId: string, sub: Subscriber): void {
    let w = this.seasons.get(seasonId);
    if (!w) {
      w = {
        meta: DEFAULT_META,
        loaded: false,
        players: null,
        error: null,
        unsubs: [],
        subs: new Set(),
        teardownTimer: null,
      };
      this.seasons.set(seasonId, w);
      this.wire(seasonId, w);
    }
    if (w.teardownTimer) {
      clearTimeout(w.teardownTimer);
      w.teardownTimer = null;
    }
    w.subs.add(sub);
  }

  private release(seasonId: string, sub: Subscriber): void {
    const w = this.seasons.get(seasonId);
    if (!w) return;
    w.subs.delete(sub);
    if (w.subs.size > 0 || w.teardownTimer) return;
    w.teardownTimer = setTimeout(() => {
      w.teardownTimer = null;
      if (w.subs.size > 0) return;
      w.unsubs.forEach((u) => u());
      this.seasons.delete(seasonId);
    }, TEARDOWN_MS);
  }

  private wire(seasonId: string, w: SeasonWatch): void {
    const db = this.ensureDb();
    w.unsubs.push(
      onSnapshot(
        seasonDoc(db, seasonId),
        (seasonSnap) => {
          w.meta = seasonSnap.exists()
            ? normalizeMeta(seasonSnap.data())
            : DEFAULT_META;
          w.loaded = seasonSnap.exists();
          w.error = null;
          this.emitSeason(seasonId);
        },
        (e) => {
          w.meta = DEFAULT_META;
          w.loaded = false;
          w.error = e?.message ?? "Failed to load season.";
          this.emitSeason(seasonId);
        },
      ),
      onSnapshot(
        playersQuery(db, seasonId),
        (psnap: QuerySnapshot<DocumentData>) => {
          const out: Player[] = [];
          psnap.forEach((docSnap) => {
            const p = normalizePlayer(docSnap.data(), docSnap.id);
            if (p) out.push(p);
          });
          w.players = out;
          w.error = null;
          this.emitSeason(seasonId);
        },
        (e) => {
          w.error = e?.message ?? "Failed to load roster.";
          w.players = [];
          this.emitSeason(seasonId);
        },
      ),
    );
  }
}

// Module singleton (one manager per tab)
const rosterWatch = new RosterWatchManager();

/**
 * Season data for the requested season, or for the active season when
 * `seasonId` is null/undefined. Parent-facing pages pass the viewed season
 * (useViewedSeasonId); admin pages omit it to follow the active season.
 *
 * On a team route (Tallies) the team scope decides instead: the route's
 * verified season, or nothing at all — never app/config. The team's
 * published current season stands in for the "active" season there.
 */
export function useRosterPlayers(seasonId?: string | null): {
  seasonId: string;
  activeSeasonId: string;
  meta: RosterMeta;
  loaded: boolean;
  players: Player[] | null;
  error: string | null;
} {
  const scope = useTeamScope();
  const admin = useAdminScope();
  // Coach area (Tallies): only the selected team's seasons, the team's own
  // current season by default, never app/config — and nothing at all
  // before a team is selected.
  const adminTeam = !scope.inTeam && admin ? admin.team : null;
  let requested: string | null;
  if (scope.inTeam) requested = scope.seasonId ?? NO_SEASON;
  else if (admin) {
    const r = seasonId?.trim() || adminTeam?.currentSeasonId || null;
    requested = r && admin.seasonIds?.has(r) ? r : NO_SEASON;
  } else requested = seasonId?.trim() || null;
  const [snap, setSnap] = React.useState<RosterSnapshot>({
    seasonId: requested === NO_SEASON ? "" : requested ?? "",
    activeSeasonId: "",
    meta: DEFAULT_META,
    loaded: false,
    players: null,
    error: null,
  });

  React.useEffect(() => {
    let active = true;
    const unsub = rosterWatch.subscribe(requested, (next) => {
      if (active) setSnap(next);
    });
    return () => {
      active = false;
      unsub();
    };
  }, [requested]);

  const privates = usePrivateProfiles(admin && requested !== NO_SEASON ? requested : null, snap.players);
  // Stable identity: screens key effects on the players array.
  const merged = React.useMemo(
    () => (snap.players && privates ? snap.players.map((p) => mergePrivate(p, privates.get(p.id))) : null),
    [snap.players, privates],
  );

  if (scope.inTeam) return { ...snap, activeSeasonId: scope.currentSeasonId ?? "" };
  if (admin) {
    return {
      ...snap,
      activeSeasonId: adminTeam?.currentSeasonId ?? "",
      players: merged,
    };
  }
  return snap;
}

/** Private roster fields (coach only) merged over the public entry. */
function mergePrivate(p: Player, d: Record<string, unknown> | undefined): Player {
  if (!d) return p;
  const merged = normalizePlayer({ ...p, stats: p.stats, ...d }, p.id) ?? p;
  return { ...merged, stats: p.stats, careerLinks: p.careerLinks };
}

/**
 * Watches seasons/{s}/players/{p}/private/profile for every roster entry
 * (owner-only docs). Returns null until every profile has reported once,
 * so coach screens never show a roster without its private fields.
 */
function usePrivateProfiles(
  seasonId: string | null,
  players: Player[] | null,
): Map<string, Record<string, unknown>> | null {
  const ids = React.useMemo(() => (players ?? []).map((p) => p.id).sort().join("|"), [players]);
  const [state, setState] = React.useState<{ key: string; map: Map<string, Record<string, unknown>> } | null>(null);
  // Includes "not loaded yet": an empty roster must still start the watch.
  const key = `${seasonId}#${players === null ? "-" : ids}`;
  React.useEffect(() => {
    if (!seasonId || players === null) return;
    const db = getFirestoreDb();
    const list = ids ? ids.split("|") : [];
    const map = new Map<string, Record<string, unknown>>();
    const seen = new Set<string>();
    const emit = () => {
      if (seen.size === list.length) setState({ key, map: new Map(map) });
    };
    emit();
    const unsubs = list.map((id) =>
      onSnapshot(
        doc(db, "seasons", seasonId, "players", id, "private", "profile"),
        (s) => {
          if (s.exists()) map.set(id, s.data());
          else map.delete(id);
          seen.add(id);
          emit();
        },
        () => {
          seen.add(id);
          emit();
        },
      ),
    );
    return () => unsubs.forEach((u) => u());
    // `players` only gates the start; the id list is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!seasonId) return new Map();
  return state?.key === key ? state.map : null;
}

export async function fetchPlayers(seasonId: string): Promise<Player[]> {
  const db = getFirestoreDb();
  const snap = await getDocs(playersQuery(db, seasonId));

  const out: Player[] = [];
  snap.forEach((docSnap) => {
    const p = normalizePlayer(docSnap.data(), docSnap.id);
    if (p) out.push(p);
  });

  return out;
}

export async function fetchCurrentSeasonId(): Promise<string> {
  const db = getFirestoreDb();
  const snap = await getDoc(configDoc(db));
  const seasonId = snap.exists()
    ? readCurrentSeasonIdFromConfigData(snap.data())
    : null;

  return seasonId ?? DEFAULT_SEASON_ID;
}
