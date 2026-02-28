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

/**
 * Fallback if app/config is missing.
 * Keep this as a safe default so the app still works locally.
 */
export const DEFAULT_SEASON_ID = "tigers-2026";

export type RosterMeta = {
  teamName: string;
  seasonLabel: string;
  league: string; // Pinto, Mustang, Bronco, Pony, Colt
  record: { wins: number; losses: number; ties?: number };
};

const DEFAULT_META: RosterMeta = {
  teamName: "Tigers",
  seasonLabel: "Spring 2026",
  league: "Mustang",
  record: { wins: 0, losses: 0 },
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

function normalizeMeta(v: unknown): RosterMeta {
  const d =
    v && typeof v === "object"
      ? (v as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  return {
    teamName: asNonEmptyString(d.teamName) ?? DEFAULT_META.teamName,
    seasonLabel: asNonEmptyString(d.seasonLabel) ?? DEFAULT_META.seasonLabel,
    league: asNonEmptyString(d.league) ?? DEFAULT_META.league,
    record: normalizeRecord(d.record),
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
    doubles: asInt(d.doubles),
    triples: asInt(d.triples),
    homeRuns: asInt(d.homeRuns),
    runs: asInt(d.runs),
    rbi: asInt(d.rbi),
    walks: asInt(d.walks),
    strikeouts: asInt(d.strikeouts),
    hitByPitch: asInt(d.hitByPitch),

    putOuts: asInt(d.putOuts),
    assists: asInt(d.assists),
  };
}

function normalizePlayer(data: unknown, fallbackId: string): Player | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  const id = typeof d.id === "string" && d.id ? d.id : fallbackId;
  const name = typeof d.name === "string" ? d.name.trim() : "";
  const number = asInt(d.number);

  if (!name) return null;

  const primaryPos = asNonEmptyString(d.primaryPos);

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
    name,
    number,
    shirtSize, // add
    stats: normalizeStats(d.stats),
  };

  if (primaryPos) p.primaryPos = primaryPos;

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
  seasonId: string;
  meta: RosterMeta;
  players: Player[] | null;
  error: string | null;
};

type Subscriber = (snap: RosterSnapshot) => void;

/**
 * A single shared Firestore watcher that survives route transitions.
 * This prevents rapid subscribe/unsubscribe churn that can trigger
 * Firestore internal assertion crashes (ca9/b815) in some SDK versions.
 */
class RosterWatchManager {
  private db: Firestore | null = null;

  private seasonId: string = DEFAULT_SEASON_ID;
  private meta: RosterMeta = DEFAULT_META;
  private players: Player[] | null = null;
  private error: string | null = null;

  private started = false;
  private seasonUnsub: Unsubscribe | null = null;
  private playersUnsub: Unsubscribe | null = null;

  private subscribers = new Set<Subscriber>();

  private teardownTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(cb: Subscriber): Unsubscribe {
    this.subscribers.add(cb);

    // Cancel pending teardown if we’re re-attaching during navigation.
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }

    // Start watchers lazily (first subscriber).
    if (!this.started) {
      this.start();
    }

    // Push current snapshot immediately.
    cb(this.snapshot());

    return () => {
      this.subscribers.delete(cb);

      // If no one is listening, delay teardown slightly so route transitions
      // (home->admin->home) don’t thrash the watch stream.
      if (this.subscribers.size === 0) {
        this.scheduleTeardown();
      }
    };
  }

  private snapshot(): RosterSnapshot {
    return {
      seasonId: this.seasonId,
      meta: this.meta,
      players: this.players,
      error: this.error,
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.subscribers) cb(snap);
  }

  private ensureDb(): Firestore {
    if (!this.db) this.db = getFirestoreDb();
    return this.db;
  }

  private scheduleTeardown(): void {
    if (this.teardownTimer) return;

    this.teardownTimer = setTimeout(() => {
      this.teardownTimer = null;

      // Only teardown if nobody re-subscribed.
      if (this.subscribers.size > 0) return;
      this.stop();
    }, 300);
  }

  private stop(): void {
    this.started = false;

    if (this.seasonUnsub) {
      this.seasonUnsub();
      this.seasonUnsub = null;
    }
    if (this.playersUnsub) {
      this.playersUnsub();
      this.playersUnsub = null;
    }
  }

  private async start(): Promise<void> {
    this.started = true;

    const db = this.ensureDb();

    // Fetch season id once on start (no realtime config listener).
    try {
      const cfgSnap = await getDoc(configDoc(db));
      const sid =
        (cfgSnap.exists()
          ? readCurrentSeasonIdFromConfigData(cfgSnap.data())
          : null) ?? DEFAULT_SEASON_ID;

      this.wireSeason(db, sid);
    } catch (e) {
      this.error = (e as Error)?.message ?? "Failed to load app config.";
      this.meta = DEFAULT_META;
      this.emit();
      this.wireSeason(db, DEFAULT_SEASON_ID);
    }
  }

  private wireSeason(db: Firestore, nextSeasonId: string): void {
    const sid = nextSeasonId?.trim() ? nextSeasonId.trim() : DEFAULT_SEASON_ID;
    if (sid === this.seasonId && this.seasonUnsub && this.playersUnsub) return;

    // Tear down existing listeners immediately when switching seasons.
    if (this.seasonUnsub) {
      this.seasonUnsub();
      this.seasonUnsub = null;
    }
    if (this.playersUnsub) {
      this.playersUnsub();
      this.playersUnsub = null;
    }

    this.seasonId = sid;
    this.error = null;
    this.emit();

    this.seasonUnsub = onSnapshot(
      seasonDoc(db, sid),
      (seasonSnap) => {
        if (!seasonSnap.exists()) {
          this.meta = DEFAULT_META;
        } else {
          this.meta = normalizeMeta(seasonSnap.data());
        }
        this.error = null;
        this.emit();
      },
      (e) => {
        this.meta = DEFAULT_META;
        this.error = e?.message ?? "Failed to load season.";
        this.emit();
      },
    );

    this.playersUnsub = onSnapshot(
      playersQuery(db, sid),
      (psnap: QuerySnapshot<DocumentData>) => {
        const out: Player[] = [];
        psnap.forEach((docSnap) => {
          const p = normalizePlayer(docSnap.data(), docSnap.id);
          if (p) out.push(p);
        });

        this.players = out;
        this.error = null;
        this.emit();
      },
      (e) => {
        this.error = e?.message ?? "Failed to load roster.";
        this.players = [];
        this.emit();
      },
    );
  }
}

// Module singleton (one watcher per tab)
const rosterWatch = new RosterWatchManager();

export function useRosterPlayers(): {
  seasonId: string;
  meta: RosterMeta;
  players: Player[] | null;
  error: string | null;
} {
  const [seasonId, setSeasonId] = React.useState<string>(DEFAULT_SEASON_ID);
  const [meta, setMeta] = React.useState<RosterMeta>(DEFAULT_META);
  const [players, setPlayers] = React.useState<Player[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    const unsub = rosterWatch.subscribe((snap) => {
      if (!active) return;
      setSeasonId(snap.seasonId);
      setMeta(snap.meta);
      setPlayers(snap.players);
      setError(snap.error);
    });

    return () => {
      active = false;
      unsub();
    };
  }, []);

  return { seasonId, meta, players, error };
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
