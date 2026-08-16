"use client";

import * as React from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirestoreDb } from "@/lib/firebase.client";

type GameLineDelta = {
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  runs: number;
  rbi: number;
  walks: number;
  strikeouts: number;
  hitByPitch: number;
};

export type PlayerGameLogItem = {
  gameId: string;
  date: string;
  opponent: string;
  result: "W" | "L" | "T";
  scoreUs: number;
  scoreThem: number;
  delta: GameLineDelta;
};

function asInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
}

function normalizeDelta(v: unknown): GameLineDelta {
  const d = v && typeof v === "object" ? (v as Record<string, unknown>) : {};

  return {
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

function compareDateDesc(a: string, b: string): number {
  return b.localeCompare(a);
}

export function usePlayerGameLog(opts: {
  seasonId: string;
  playerId: string;
}): {
  items: PlayerGameLogItem[] | null;
  loading: boolean;
  error: string | null;
} {
  const { seasonId, playerId } = opts;

  const [items, setItems] = React.useState<PlayerGameLogItem[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!seasonId || !playerId) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    const db: Firestore = getFirestoreDb();
    const gamesRef = query(collection(db, "seasons", seasonId, "games"));

    let active = true;
    let childUnsubs: Unsubscribe[] = [];

    const clearChildren = () => {
      childUnsubs.forEach((unsub) => unsub());
      childUnsubs = [];
    };

    const unsubGames = onSnapshot(
      gamesRef,
      (gamesSnap) => {
        clearChildren();

        const gameMap = new Map<string, PlayerGameLogItem>();

        if (gamesSnap.empty) {
          if (!active) return;
          setItems([]);
          setLoading(false);
          setError(null);
          return;
        }

        let remaining = gamesSnap.docs.length;

        const finishIfReady = () => {
          remaining -= 1;
          if (remaining > 0 || !active) return;

          const next = [...gameMap.values()].sort((a, b) =>
            compareDateDesc(a.date, b.date),
          );

          setItems(next);
          setLoading(false);
          setError(null);
        };

        gamesSnap.forEach((gameDoc) => {
          const gameData = gameDoc.data() as Record<string, unknown>;
          const lineRef = doc(
            db,
            "seasons",
            seasonId,
            "games",
            gameDoc.id,
            "lines",
            playerId,
          );

          const unsubLine = onSnapshot(
            lineRef,
            (lineSnap) => {
              if (!lineSnap.exists()) {
                gameMap.delete(gameDoc.id);
                finishIfReady();
                return;
              }

              const lineData = lineSnap.data() as Record<string, unknown>;
              const score =
                gameData.score && typeof gameData.score === "object"
                  ? (gameData.score as Record<string, unknown>)
                  : {};

              gameMap.set(gameDoc.id, {
                gameId: gameDoc.id,
                date:
                  typeof gameData.date === "string" ? gameData.date : "Unknown",
                opponent:
                  typeof gameData.opponent === "string"
                    ? gameData.opponent
                    : "Opponent",
                result:
                  gameData.result === "L" || gameData.result === "T"
                    ? gameData.result
                    : "W",
                scoreUs: asInt(score.us),
                scoreThem: asInt(score.them),
                delta: normalizeDelta(lineData.delta),
              });

              finishIfReady();
            },
            (e) => {
              if (!active) return;
              setError(e?.message ?? "Failed to load game log.");
              setLoading(false);
            },
          );

          childUnsubs.push(unsubLine);
        });
      },
      (e) => {
        if (!active) return;
        setError(e?.message ?? "Failed to load games.");
        setItems([]);
        setLoading(false);
      },
    );

    return () => {
      active = false;
      clearChildren();
      unsubGames();
    };
  }, [seasonId, playerId]);

  return { items, loading, error };
}
