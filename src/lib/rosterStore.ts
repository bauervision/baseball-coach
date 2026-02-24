// lib/rosterStore.ts
import * as React from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import type { Player, PlayerBattingStats } from "@/lib/roster";

/**
 * Single source of truth for which season is public.
 * Doc: app/config
 * Field: currentSeasonId: string
 */
const APP_CONFIG_DOC = doc(firestore, "app", "config");

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

  const p: Player = {
    id,
    name,
    number,
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
    let seasonUnsub: Unsubscribe | null = null;
    let playersUnsub: Unsubscribe | null = null;

    // Critical: guard against rapid rewire churn.
    const lastSeasonIdRef = { current: "" as string };

    function cleanupSeasonListeners() {
      if (seasonUnsub) {
        seasonUnsub();
        seasonUnsub = null;
      }
      if (playersUnsub) {
        playersUnsub();
        playersUnsub = null;
      }
    }

    function wireSeasonListeners(nextSeasonId: string) {
      if (!nextSeasonId) nextSeasonId = DEFAULT_SEASON_ID;

      // Only rewire if the season actually changed.
      if (lastSeasonIdRef.current === nextSeasonId) return;
      lastSeasonIdRef.current = nextSeasonId;

      cleanupSeasonListeners();

      setSeasonId(nextSeasonId);

      // Meta: seasons/{seasonId}
      const seasonRef = doc(firestore, "seasons", nextSeasonId);
      seasonUnsub = onSnapshot(
        seasonRef,
        (seasonSnap) => {
          if (!seasonSnap.exists()) {
            setMeta(DEFAULT_META);
            return;
          }
          setMeta(normalizeMeta(seasonSnap.data()));
        },
        (e) => {
          setMeta(DEFAULT_META);
          setError(e?.message ?? "Failed to load season.");
        },
      );

      // Players: seasons/{seasonId}/players
      const qy = query(collection(firestore, "seasons", nextSeasonId, "players"));
      playersUnsub = onSnapshot(
        qy,
        (psnap) => {
          const out: Player[] = [];
          psnap.forEach((docSnap) => {
            const p = normalizePlayer(docSnap.data(), docSnap.id);
            if (p) out.push(p);
          });
          setPlayers(out);
          setError(null);
        },
        (e) => {
          setError(e?.message ?? "Failed to load roster.");
          setPlayers([]);
        },
      );
    }

    // Subscribe to app/config to get currentSeasonId.
    const configUnsub = onSnapshot(
      APP_CONFIG_DOC,
      (snap) => {
        const cfgSeasonId =
          (snap.exists() ? readCurrentSeasonIdFromConfigData(snap.data()) : null) ??
          DEFAULT_SEASON_ID;

        wireSeasonListeners(cfgSeasonId);
      },
      (e) => {
        // If config fails, fall back but keep app usable.
        setError(e?.message ?? "Failed to load app config.");
        setMeta(DEFAULT_META);
        wireSeasonListeners(DEFAULT_SEASON_ID);
      },
    );

    return () => {
      configUnsub();
      cleanupSeasonListeners();
    };
  }, []);

  return { seasonId, meta, players, error };
}

export async function fetchPlayers(seasonId: string): Promise<Player[]> {
  const qy = query(collection(firestore, "seasons", seasonId, "players"));
  const snap = await getDocs(qy);

  const out: Player[] = [];
  snap.forEach((docSnap) => {
    const p = normalizePlayer(docSnap.data(), docSnap.id);
    if (p) out.push(p);
  });

  return out;
}

export async function fetchCurrentSeasonId(): Promise<string> {
  const snap = await getDoc(APP_CONFIG_DOC);
  const seasonId = snap.exists()
    ? readCurrentSeasonIdFromConfigData(snap.data())
    : null;

  return seasonId ?? DEFAULT_SEASON_ID;
}