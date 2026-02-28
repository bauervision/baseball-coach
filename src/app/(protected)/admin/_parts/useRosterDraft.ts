// app/admin/_parts/useRosterDraft.ts
"use client";

import * as React from "react";
import type { Firestore } from "firebase/firestore";
import type { DraftPlayer } from "../adminHelpers";
import { newDraftPlayer } from "../adminHelpers";
import { rebuildRoster } from "./adminActions";

export function useRosterDraft(opts: {
  db: Firestore;
  seasonId: string;
  canEdit: boolean;
}) {
  const { db, seasonId, canEdit } = opts;

  const [draft, setDraft] = React.useState<DraftPlayer[]>(() => [newDraftPlayer()]);
  const [rosterBusy, setRosterBusy] = React.useState(false);
  const [rosterMsg, setRosterMsg] = React.useState<string | null>(null);
  const [rosterErr, setRosterErr] = React.useState<string | null>(null);

  function updateDraftRow(key: string, patch: Partial<DraftPlayer>) {
    setDraft((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function insertRowAfter(key: string) {
    setDraft((prev) => {
      const idx = prev.findIndex((r) => r.key === key);
      if (idx < 0) return prev;
      const next = [...prev];
      next.splice(idx + 1, 0, newDraftPlayer());
      return next;
    });
  }

  function removeRow(key: string) {
    setDraft((prev) => {
      const next = prev.filter((r) => r.key !== key);
      return next.length ? next : [newDraftPlayer()];
    });
  }

  const onRebuildRosterAction = React.useCallback(async () => {
    if (!canEdit || rosterBusy) return;

    setRosterBusy(true);
    setRosterMsg(null);
    setRosterErr(null);

    try {
      const res = await rebuildRoster({ db, seasonId, draft });
      setRosterMsg(`Roster rebuilt for ${seasonId}. Players: ${res.playerCount}.`);
      setDraft([newDraftPlayer()]);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Failed to rebuild roster.";
      setRosterErr(msg);
    } finally {
      setRosterBusy(false);
    }
  }, [canEdit, rosterBusy, db, seasonId, draft]);

  return {
    draft,
    setDraft,
    updateDraftRow,
    insertRowAfter,
    removeRow,
    rosterBusy,
    rosterMsg,
    rosterErr,
    onRebuildRosterAction,
  };
}