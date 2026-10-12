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
import { orderPlayersByLineup, type LineupPlayerRow } from "@/lib/lineup";
import { subscribeCurrentLineup } from "@/lib/lineupStore";
import {
  asGameType,
  gameTypeLabel,
  DEFAULT_GAME_TYPE,
  type GameType,
} from "@/lib/gameClassification";
import { groupGameBallPlayers } from "@/lib/gameBall";

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
import {
  dirtyPlayerIds,
  hasUnsavedGameChanges,
  type GameFormSnapshot,
} from "../unsavedEdits";

type SavedGameOption = {
  id: string;
  label: string;
  gameBallPlayerId: string;
  gameType: GameType;
};

const DISCARD_PROMPT = "You have unsaved changes in this game. Discard them?";

function emptyFormSnapshot(): GameFormSnapshot {
  return {
    lines: {},
    coachPicks: { ...EMPTY_COACH_PICKS },
    gameBallPlayerId: "",
    gameType: DEFAULT_GAME_TYPE,
    date: todayISO(),
    opponent: "",
    result: "W",
    scoreUs: "0",
    scoreThem: "0",
  };
}

type SavedGameDoc = {
  date?: unknown;
  opponent?: unknown;
  result?: unknown;
  gameType?: unknown;
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
  gameBall?: {
    playerId?: unknown;
    playerName?: unknown;
    playerNumber?: unknown;
  } | null;
  lineupSnapshot?: {
    capturedAtISO?: unknown;
    inningCount?: unknown;
    rows?: unknown;
  } | null;
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

function asGameBallPlayerId(v: SavedGameDoc["gameBall"]): string {
  return v && typeof v.playerId === "string" ? v.playerId : "";
}

function parseLineupSnapshotRows(
  v: SavedGameDoc["lineupSnapshot"],
): LineupPlayerRow[] | null {
  if (!v || !Array.isArray(v.rows)) return null;

  const rows = v.rows
    .filter(
      (row): row is { playerId: string; battingOrder: number } =>
        !!row &&
        typeof row === "object" &&
        typeof (row as { playerId?: unknown }).playerId === "string" &&
        typeof (row as { battingOrder?: unknown }).battingOrder === "number",
    )
    .map((row) => ({
      playerId: row.playerId,
      battingOrder: row.battingOrder,
      innings:
        (row as LineupPlayerRow).innings &&
        typeof (row as LineupPlayerRow).innings === "object"
          ? (row as LineupPlayerRow).innings
          : {},
    }));

  return rows.length > 0 ? rows : null;
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
  const [gameBallPlayerId, setGameBallPlayerId] = React.useState("");

  const [date, setDate] = React.useState(todayISO());
  const [opponent, setOpponent] = React.useState("");
  const [result, setResult] = React.useState<GameResult>("W");
  const [gameType, setGameType] = React.useState<GameType>(DEFAULT_GAME_TYPE);
  const [scoreUs, setScoreUs] = React.useState("0");
  const [scoreThem, setScoreThem] = React.useState("0");

  const [editingGameId, setEditingGameId] = React.useState<string | null>(null);
  const [savedGames, setSavedGames] = React.useState<SavedGameOption[]>([]);
  const [gamesLoading, setGamesLoading] = React.useState(false);
  const [loadingGame, setLoadingGame] = React.useState(false);

  // Batting order source for the Stat Update list (requirement #1/#3):
  // the live "current" lineup while building a new game that has no saved
  // snapshot yet, and the frozen snapshot on the game being edited once one
  // exists. Neither read is per-player — a single lineup doc each.
  const [currentLineupRows, setCurrentLineupRows] = React.useState<
    LineupPlayerRow[] | null
  >(null);
  const [editingGameLineupRows, setEditingGameLineupRows] = React.useState<
    LineupPlayerRow[] | null
  >(null);

  const [saving, setSaving] = React.useState(false);
  // Synchronous guard: two fast clicks can both see `saving === false`
  // before React re-renders, so the state flag alone can't stop a double
  // submit.
  const savingRef = React.useRef(false);

  // Form as last loaded/saved; edits are "unsaved" relative to this.
  const [baseline, setBaseline] =
    React.useState<GameFormSnapshot>(emptyFormSnapshot);
  // Player whose row most recently received a stat edit; that row shows
  // the contextual Save Data button.
  const [activeEditPlayerId, setActiveEditPlayerId] = React.useState<
    string | null
  >(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [savedMsg, setSavedMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    const unsubscribe = subscribeCurrentLineup(db, seasonId, (lineup) => {
      setCurrentLineupRows(lineup?.rows ?? null);
    });
    return unsubscribe;
  }, [db, seasonId]);

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
        const type = asGameType(data.gameType);
        const typeSuffix =
          type === DEFAULT_GAME_TYPE ? "" : ` • ${gameTypeLabel(type)}`;
        return {
          id: snap.id,
          label: `${gameDate} • ${opp} • ${res}${typeSuffix}`,
          gameBallPlayerId: asGameBallPlayerId(data.gameBall),
          gameType: type,
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
    setGameBallPlayerId("");
    setEditingGameId(null);
    setEditingGameLineupRows(null);
    setDate(todayISO());
    setOpponent("");
    setResult("W");
    setGameType(DEFAULT_GAME_TYPE);
    setScoreUs("0");
    setScoreThem("0");
    setSaveError(null);
    setSavedMsg(null);
    setBaseline(emptyFormSnapshot());
    setActiveEditPlayerId(null);
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
        setEditingGameLineupRows(parseLineupSnapshotRows(gameData.lineupSnapshot));
        setDate(asString(gameData.date, todayISO()));
        setOpponent(asString(gameData.opponent, ""));
        setResult(asGameResult(gameData.result));
        setGameType(asGameType(gameData.gameType));
        setScoreUs(asNumberString(gameData.score?.us));
        setScoreThem(asNumberString(gameData.score?.them));
        setLines(nextLines);
        setCoachPicks(nextCoachPicks);
        setGameBallPlayerId(asGameBallPlayerId(gameData.gameBall));
        setBaseline({
          lines: nextLines,
          coachPicks: nextCoachPicks,
          gameBallPlayerId: asGameBallPlayerId(gameData.gameBall),
          gameType: asGameType(gameData.gameType),
          date: asString(gameData.date, todayISO()),
          opponent: asString(gameData.opponent, ""),
          result: asGameResult(gameData.result),
          scoreUs: asNumberString(gameData.score?.us),
          scoreThem: asNumberString(gameData.score?.them),
        });
        setActiveEditPlayerId(null);
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
    setActiveEditPlayerId(playerId);
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

  // Batting order for the Stat Update list: the game being edited uses its
  // own frozen snapshot once one exists; a new, not-yet-saved game falls
  // back to whatever the current lineup is right now. Players missing from
  // the lineup (e.g. added afterward) keep their existing order and land
  // at the end rather than being dropped. When no lineup data is available
  // at all (old game with no snapshot, or no current lineup saved yet),
  // this falls back to the previous default: jersey number, then name.
  const orderedPlayers = React.useMemo(() => {
    const byNumberThenName = (players ?? []).slice().sort((a, b) => {
      const na = Number(a.number ?? 0);
      const nb = Number(b.number ?? 0);
      if (na !== nb) return na - nb;
      return String(a.name).localeCompare(String(b.name));
    });

    const rows = editingGameId ? editingGameLineupRows : currentLineupRows;
    return orderPlayersByLineup(byNumberThenName, rows);
  }, [players, editingGameId, editingGameLineupRows, currentLineupRows]);

  // Every player stays selectable; prior recipients (in other games) are
  // grouped separately with their counts. Derived from the already-loaded
  // games list, so no per-player reads are needed.
  const gameBallGroups = React.useMemo(
    () => groupGameBallPlayers(players ?? [], savedGames, editingGameId),
    [players, savedGames, editingGameId],
  );

  const currentSnapshot = React.useMemo<GameFormSnapshot>(
    () => ({
      lines,
      coachPicks,
      gameBallPlayerId,
      gameType,
      date,
      opponent,
      result,
      scoreUs,
      scoreThem,
    }),
    [
      lines,
      coachPicks,
      gameBallPlayerId,
      gameType,
      date,
      opponent,
      result,
      scoreUs,
      scoreThem,
    ],
  );

  const unsavedPlayerIds = React.useMemo(
    () => dirtyPlayerIds(lines, baseline.lines),
    [lines, baseline],
  );

  const hasUnsavedChanges = React.useMemo(
    () => hasUnsavedGameChanges(currentSnapshot, baseline),
    [currentSnapshot, baseline],
  );

  // Guarded versions of the discard paths used by the UI: switching games
  // or starting over never silently drops unsaved edits.
  const confirmDiscard = React.useCallback(() => {
    if (!hasUnsavedChanges) return true;
    return window.confirm(DISCARD_PROMPT);
  }, [hasUnsavedChanges]);

  const requestResetAction = React.useCallback(() => {
    if (confirmDiscard()) resetAllAction();
  }, [confirmDiscard, resetAllAction]);

  const requestLoadGameAction = React.useCallback(
    (gameId: string) => {
      if (confirmDiscard()) void loadExistingGameAction(gameId);
    },
    [confirmDiscard, loadExistingGameAction],
  );

  const onSaveGameAction = React.useCallback(async () => {
    if (!canEdit || savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setSavedMsg(null);

    // What is being submitted becomes the new baseline on success; edits
    // typed while the save is in flight stay marked unsaved.
    const submitted = currentSnapshot;

    try {
      const ps = players ?? [];
      const wasNewGame = !editingGameId;
      const res = await saveGameAndApplyDeltas({
        db,
        seasonId,
        date,
        opponent,
        result,
        gameType,
        scoreUs,
        scoreThem,
        players: ps,
        lines,
        coachPicks,
        gameBallPlayerId,
        gameId: editingGameId,
      });

      setSavedMsg(
        editingGameId
          ? `Updated game vs ${res.opponent}. Updated ${res.wroteLines} player(s).`
          : `Saved game vs ${res.opponent}. Updated ${res.wroteLines} player(s).`,
      );

      setEditingGameId(res.gameId);
      setBaseline(submitted);
      // The snapshot just captured server-side for a brand-new game is
      // exactly the current lineup we already have locally — reuse it so
      // the list doesn't flash back to default ordering post-save.
      if (wasNewGame) setEditingGameLineupRows(currentLineupRows);
      await loadSavedGamesAction();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Save failed.";
      setSaveError(msg);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [
    canEdit,
    currentSnapshot,
    players,
    db,
    seasonId,
    date,
    opponent,
    result,
    gameType,
    scoreUs,
    scoreThem,
    lines,
    coachPicks,
    gameBallPlayerId,
    editingGameId,
    currentLineupRows,
    loadSavedGamesAction,
  ]);

  return {
    lines,
    coachPicks,
    orderedPlayers,
    gameBallPlayerId,
    setGameBallPlayerIdAction: setGameBallPlayerId,
    gameBallGroups,
    setDeltaValue,
    setCoachPickAction,
    toggleHidden,
    unhideAllAction,
    resetAllAction,
    requestResetAction,
    hiddenCount,
    playedCount,

    date,
    setDate,
    opponent,
    setOpponent,
    result,
    setResult,
    gameType,
    setGameType,
    scoreUs,
    setScoreUs,
    scoreThem,
    setScoreThem,

    savedGames,
    gamesLoading,
    loadingGame,
    editingGameId,
    loadExistingGameAction,
    requestLoadGameAction,

    unsavedPlayerIds,
    hasUnsavedChanges,
    activeEditPlayerId,

    saving,

    saveError,
    savedMsg,
    onSaveGameAction,
  };
}
