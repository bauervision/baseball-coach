//src/app/(protected)/admin/_parts/useGameEntry.ts
"use client";

import * as React from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  type Firestore,
} from "firebase/firestore";
import type { Player } from "@/lib/roster";

import {
  LineState,
  todayISO,
  GameResult,
  EMPTY_DELTA,
  EMPTY_COACH_PICKS,
  anyNonZero,
  type LineDelta,
  type CoachPickKey,
  type CoachPicks,
} from "../adminHelpers";
import { saveGameAndApplyDeltas } from "./adminActions";

type SavedGameOption = {
  id: string;
  label: string;
};

type SavedGameDoc = {
  date?: unknown;
  opponent?: unknown;
  result?: unknown;
  score?: {
    us?: unknown;
    them?: unknown;
  };
  coachAwards?: Record<
    string,
    {
      playerId?: unknown;
      playerName?: unknown;
      playerNumber?: unknown;
    }
  >;
};

type SavedLineDoc = {
  playerId?: unknown;
  delta?: Partial<Record<keyof LineDelta, unknown>>;
};

function asGameResult(v: unknown): GameResult {
  return v === "L" || v === "T" ? v : "W";
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNumberString(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "0";
}

function emptyLinesForPlayers(
  players: Player[] | null,
): Record<string, LineState> {
  const out: Record<string, LineState> = {};
  for (const p of players ?? []) {
    out[p.id] = { hidden: false, delta: { ...EMPTY_DELTA } };
  }
  return out;
}

export function useGameEntry(opts: {
  db: Firestore;
  seasonId: string;
  players: Player[] | null;
  canEdit: boolean;
}) {
  const { db, seasonId, players, canEdit } = opts;

  const [lines, setLines] = React.useState<Record<string, LineState>>({});
  const [coachPicks, setCoachPicks] =
    React.useState<CoachPicks>(EMPTY_COACH_PICKS);

  const [date, setDate] = React.useState(todayISO());
  const [opponent, setOpponent] = React.useState("");
  const [result, setResult] = React.useState<GameResult>("W");
  const [scoreUs, setScoreUs] = React.useState("0");
  const [scoreThem, setScoreThem] = React.useState("0");

  const [editingGameId, setEditingGameId] = React.useState<string | null>(null);
  const [savedGames, setSavedGames] = React.useState<SavedGameOption[]>([]);
  const [gamesLoading, setGamesLoading] = React.useState(false);
  const [loadingGame, setLoadingGame] = React.useState(false);

  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [savedMsg, setSavedMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ps = players ?? null;
    if (ps === null) return;

    setLines((prev) => {
      const next: Record<string, LineState> = { ...prev };

      for (const p of ps) {
        if (!next[p.id]) {
          next[p.id] = { hidden: false, delta: { ...EMPTY_DELTA } };
        }
      }

      for (const k of Object.keys(next)) {
        if (!ps.find((p) => p.id === k)) delete next[k];
      }

      return next;
    });

    setCoachPicks((prev) => {
      const validIds = new Set(ps.map((p) => p.id));
      const next: CoachPicks = { ...prev };

      (Object.keys(next) as CoachPickKey[]).forEach((key) => {
        const pickedId = next[key];
        if (pickedId && !validIds.has(pickedId)) {
          next[key] = "";
        }
      });

      return next;
    });
  }, [players]);

  const loadSavedGamesAction = React.useCallback(async () => {
    setGamesLoading(true);

    try {
      const gamesSnap = await getDocs(
        query(
          collection(db, "seasons", seasonId, "games"),
          orderBy("date", "desc"),
        ),
      );

      const next: SavedGameOption[] = gamesSnap.docs.map((snap) => {
        const data = snap.data() as SavedGameDoc;
        const gameDate = asString(data.date, "Unknown date");
        const opp = asString(data.opponent, "Opponent");
        const res = asString(data.result, "?");
        return {
          id: snap.id,
          label: `${gameDate} • ${opp} • ${res}`,
        };
      });

      setSavedGames(next);
    } catch {
      setSavedGames([]);
    } finally {
      setGamesLoading(false);
    }
  }, [db, seasonId]);

  React.useEffect(() => {
    void loadSavedGamesAction();
  }, [loadSavedGamesAction]);

  const resetAllAction = React.useCallback(() => {
    setLines((prev) => {
      const out: Record<string, LineState> = { ...prev };
      for (const k of Object.keys(out)) {
        out[k] = { ...out[k], hidden: false, delta: { ...EMPTY_DELTA } };
      }
      return out;
    });
    setCoachPicks({ ...EMPTY_COACH_PICKS });
    setEditingGameId(null);
    setDate(todayISO());
    setOpponent("");
    setResult("W");
    setScoreUs("0");
    setScoreThem("0");
    setSaveError(null);
    setSavedMsg(null);
  }, []);

  React.useEffect(() => {
    resetAllAction();
    setSavedGames([]);
  }, [seasonId, resetAllAction]);

  const loadExistingGameAction = React.useCallback(
    async (gameId: string) => {
      const gid = gameId.trim();
      if (!gid) {
        resetAllAction();
        return;
      }

      setLoadingGame(true);
      setSaveError(null);
      setSavedMsg(null);

      try {
        const gameSnap = await getDoc(
          doc(db, "seasons", seasonId, "games", gid),
        );
        if (!gameSnap.exists()) {
          throw new Error("Game not found.");
        }

        const gameData = gameSnap.data() as SavedGameDoc;

        const nextLines = emptyLinesForPlayers(players);
        const nextCoachPicks: CoachPicks = { ...EMPTY_COACH_PICKS };

        const coachAwards = gameData.coachAwards;
        if (coachAwards && typeof coachAwards === "object") {
          for (const [key, award] of Object.entries(coachAwards)) {
            if (!(key in EMPTY_COACH_PICKS)) continue;

            const playerId =
              award && typeof award.playerId === "string" ? award.playerId : "";

            if (!playerId) continue;

            nextCoachPicks[key as CoachPickKey] = playerId;
          }
        }

        const lineSnap = await getDocs(
          collection(db, "seasons", seasonId, "games", gid, "lines"),
        );

        lineSnap.forEach((snap) => {
          const data = snap.data() as SavedLineDoc;
          const playerId =
            typeof data.playerId === "string" ? data.playerId : snap.id;

          if (!nextLines[playerId]) return;

          const rawDelta = data.delta;
          const delta: LineDelta = { ...EMPTY_DELTA };

          if (rawDelta && typeof rawDelta === "object") {
            (Object.keys(delta) as Array<keyof LineDelta>).forEach((key) => {
              const value = rawDelta[key];
              delta[key] =
                typeof value === "number" && Number.isFinite(value)
                  ? Math.max(0, Math.floor(value))
                  : 0;
            });
          }

          nextLines[playerId] = {
            hidden: false,
            delta,
          };
        });

        setEditingGameId(gid);
        setDate(asString(gameData.date, todayISO()));
        setOpponent(asString(gameData.opponent, ""));
        setResult(asGameResult(gameData.result));
        setScoreUs(asNumberString(gameData.score?.us));
        setScoreThem(asNumberString(gameData.score?.them));
        setLines(nextLines);
        setCoachPicks(nextCoachPicks);
      } catch (e: unknown) {
        const msg =
          e && typeof e === "object" && "message" in e
            ? String((e as { message?: unknown }).message)
            : "Failed to load game.";
        setSaveError(msg);
      } finally {
        setLoadingGame(false);
      }
    },
    [db, seasonId, players, resetAllAction],
  );

  const hiddenCount = React.useMemo(() => {
    return Object.values(lines).filter((l) => l.hidden).length;
  }, [lines]);

  const playedCount = React.useMemo(() => {
    const ps = players ?? [];
    let n = 0;
    for (const p of ps) {
      const l = lines[p.id];
      if (!l) continue;
      if (anyNonZero(l.delta)) n++;
    }
    return n;
  }, [players, lines]);

  function setDeltaValue(
    playerId: string,
    key: keyof LineDelta,
    value: number,
  ) {
    setLines((prev) => {
      const cur = prev[playerId];
      if (!cur) return prev;

      return {
        ...prev,
        [playerId]: {
          ...cur,
          delta: {
            ...cur.delta,
            [key]: Math.max(0, Math.floor(value)),
          },
        },
      };
    });
  }

  function setCoachPickAction(key: CoachPickKey, playerId: string) {
    setCoachPicks((prev) => ({
      ...prev,
      [key]: playerId,
    }));
  }

  function toggleHidden(playerId: string) {
    setLines((prev) => {
      const cur = prev[playerId];
      if (!cur) return prev;
      return {
        ...prev,
        [playerId]: { ...cur, hidden: !cur.hidden },
      };
    });
  }

  const unhideAllAction = React.useCallback(() => {
    setLines((prev) => {
      const out: Record<string, LineState> = { ...prev };
      for (const k of Object.keys(out)) {
        out[k] = { ...out[k], hidden: false };
      }
      return out;
    });
  }, []);

  const onSaveGameAction = React.useCallback(async () => {
    if (!canEdit || saving) return;

    setSaving(true);
    setSaveError(null);
    setSavedMsg(null);

    try {
      const ps = players ?? [];
      const res = await saveGameAndApplyDeltas({
        db,
        seasonId,
        date,
        opponent,
        result,
        scoreUs,
        scoreThem,
        players: ps,
        lines,
        coachPicks,
        gameId: editingGameId,
      });

      setSavedMsg(
        editingGameId
          ? `Updated game vs ${res.opponent}. Updated ${res.wroteLines} player(s).`
          : `Saved game vs ${res.opponent}. Updated ${res.wroteLines} player(s).`,
      );

      setEditingGameId(res.gameId);
      await loadSavedGamesAction();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Save failed.";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [
    canEdit,
    saving,
    players,
    db,
    seasonId,
    date,
    opponent,
    result,
    scoreUs,
    scoreThem,
    lines,
    coachPicks,
    editingGameId,
    loadSavedGamesAction,
  ]);

  return {
    lines,
    coachPicks,
    setDeltaValue,
    setCoachPickAction,
    toggleHidden,
    unhideAllAction,
    resetAllAction,
    hiddenCount,
    playedCount,

    date,
    setDate,
    opponent,
    setOpponent,
    result,
    setResult,
    scoreUs,
    setScoreUs,
    scoreThem,
    setScoreThem,

    savedGames,
    gamesLoading,
    loadingGame,
    editingGameId,
    loadExistingGameAction,

    saving,
    saveError,
    savedMsg,
    onSaveGameAction,
  };
}
