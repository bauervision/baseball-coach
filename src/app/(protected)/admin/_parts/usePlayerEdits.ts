// app/admin/_parts/usePlayerEdits.ts
"use client";

import * as React from "react";
import type { Firestore } from "firebase/firestore";
import type { Player } from "@/lib/roster";

import { savePlayerEdits } from "./adminActions";

export function usePlayerEdits(opts: {
  db: Firestore;
  seasonId: string;
  players: Player[] | null;
  canEdit: boolean;
}) {
  const { db, seasonId, players, canEdit } = opts;

  const [playerEdits, setPlayerEdits] = React.useState<
    Record<string, { name: string; number: string; dirty: boolean }>
  >({});
  const [playerBusy, setPlayerBusy] = React.useState(false);
  const [playerMsg, setPlayerMsg] = React.useState<string | null>(null);
  const [playerErr, setPlayerErr] = React.useState<string | null>(null);

  // Keep Player Update form state in sync with roster changes
  React.useEffect(() => {
    const ps = players ?? null;
    if (ps === null) return;

    setPlayerEdits((prev) => {
      const out: Record<string, { name: string; number: string; dirty: boolean }> =
        { ...prev };

      for (const p of ps) {
        const existing = out[p.id];
        if (!existing) {
          out[p.id] = { name: p.name, number: String(p.number ?? 0), dirty: false };
          continue;
        }

        if (!existing.dirty) {
          out[p.id] = { name: p.name, number: String(p.number ?? 0), dirty: false };
        }
      }

      for (const k of Object.keys(out)) {
        if (!ps.find((p) => p.id === k)) delete out[k];
      }

      return out;
    });
  }, [players]);

  function setPlayerEditValue(
    playerId: string,
    patch: Partial<{ name: string; number: string }>,
  ) {
    setPlayerEdits((prev) => {
      const cur = prev[playerId] ?? { name: "", number: "0", dirty: false };
      return {
        ...prev,
        [playerId]: {
          name: patch.name ?? cur.name,
          number: patch.number ?? cur.number,
          dirty: true,
        },
      };
    });
  }

  const dirtyPlayersCount = React.useMemo(() => {
    return Object.values(playerEdits).filter((p) => p.dirty).length;
  }, [playerEdits]);

  const onSavePlayerEditsAction = React.useCallback(async () => {
    if (!canEdit || playerBusy) return;

    setPlayerBusy(true);
    setPlayerMsg(null);
    setPlayerErr(null);

    try {
      const ps = players ?? [];
      const res = await savePlayerEdits({
        db,
        seasonId,
        players: ps,
        edits: playerEdits,
      });

      setPlayerMsg(`Saved changes for ${res.wrote} player(s).`);

      setPlayerEdits((prev) => {
        const out = { ...prev };
        for (const k of Object.keys(out)) out[k] = { ...out[k], dirty: false };
        return out;
      });
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Failed to save player changes.";
      setPlayerErr(msg);
    } finally {
      setPlayerBusy(false);
    }
  }, [canEdit, playerBusy, players, db, seasonId, playerEdits]);

  return {
    playerEdits,
    setPlayerEditValue,
    dirtyPlayersCount,
    playerBusy,
    playerMsg,
    playerErr,
    onSavePlayerEditsAction,
  };
}