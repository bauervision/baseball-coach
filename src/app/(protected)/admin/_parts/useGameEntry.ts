// app/admin/_parts/useGameEntry.ts
"use client";

import * as React from "react";
import type { Firestore } from "firebase/firestore";
import type { Player } from "@/lib/roster";

import {
  LineState,
  todayISO,
  GameResult,
  EMPTY_DELTA,
  anyNonZero,
  type LineDelta,
} from "../adminHelpers";
import { saveGameAndApplyDeltas } from "./adminActions";

export function useGameEntry(opts: {
  db: Firestore;
  seasonId: string;
  players: Player[] | null;
  canEdit: boolean;
}) {
  const { db, seasonId, players, canEdit } = opts;

  const [lines, setLines] = React.useState<Record<string, LineState>>({});

  const [date, setDate] = React.useState(todayISO());
  const [opponent, setOpponent] = React.useState("");
  const [result, setResult] = React.useState<GameResult>("W");
  const [scoreUs, setScoreUs] = React.useState("0");
  const [scoreThem, setScoreThem] = React.useState("0");

  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [savedMsg, setSavedMsg] = React.useState<string | null>(null);

  // Keep game-entry lines in sync with roster changes.
  React.useEffect(() => {
    const ps = players ?? null;
    if (ps === null) return;

    setLines((prev) => {
      const next: Record<string, LineState> = { ...prev };

      for (const p of ps) {
        if (!next[p.id]) next[p.id] = { hidden: false, delta: { ...EMPTY_DELTA } };
      }

      for (const k of Object.keys(next)) {
        if (!ps.find((p) => p.id === k)) delete next[k];
      }

      return next;
    });
  }, [players]);

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

  function setDeltaValue(playerId: string, key: keyof LineDelta, value: number) {
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

  const resetAllAction = React.useCallback(() => {
    setLines((prev) => {
      const out: Record<string, LineState> = { ...prev };
      for (const k of Object.keys(out)) {
        out[k] = { ...out[k], delta: { ...EMPTY_DELTA } };
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
      });

      setSavedMsg(`Saved game vs ${res.opponent}. Updated ${res.wroteLines} player(s).`);

      // reset deltas
      setLines((prev) => {
        const out: Record<string, LineState> = { ...prev };
        for (const k of Object.keys(out)) {
          out[k] = { ...out[k], delta: { ...EMPTY_DELTA } };
        }
        return out;
      });
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
  ]);

  return {
    lines,
    setDeltaValue,
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

    saving,
    saveError,
    savedMsg,
    onSaveGameAction,
  };
}