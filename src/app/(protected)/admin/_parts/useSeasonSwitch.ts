// app/admin/_parts/useSeasonSwitch.ts
"use client";

import * as React from "react";
import type { Firestore } from "firebase/firestore";
import { switchSeason } from "./adminActions";

export function useSeasonSwitch(opts: {
  db: Firestore;
  canEdit: boolean;
  fallbackTeamName: string;
}) {
  const { db, canEdit, fallbackTeamName } = opts;

  const [seasonEditId, setSeasonEditId] = React.useState("");
  const [seasonTeamName, setSeasonTeamName] = React.useState("");
  const [seasonLabel, setSeasonLabel] = React.useState("");
  const [seasonBusy, setSeasonBusy] = React.useState(false);
  const [seasonMsg, setSeasonMsg] = React.useState<string | null>(null);
  const [seasonErr, setSeasonErr] = React.useState<string | null>(null);

  const onSwitchSeasonAction = React.useCallback(async () => {
    if (!canEdit || seasonBusy) return;

    setSeasonBusy(true);
    setSeasonMsg(null);
    setSeasonErr(null);

    try {
      await switchSeason({
        db,
        nextSeasonId: seasonEditId,
        teamName: seasonTeamName,
        seasonLabel,
        fallbackTeamName,
      });

      setSeasonMsg(`Current season set to ${seasonEditId.trim()}.`);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message)
          : "Failed to switch season.";
      setSeasonErr(msg);
    } finally {
      setSeasonBusy(false);
    }
  }, [canEdit, seasonBusy, db, seasonEditId, seasonTeamName, seasonLabel, fallbackTeamName]);

  return {
    seasonEditId,
    setSeasonEditId,
    seasonTeamName,
    setSeasonTeamName,
    seasonLabel,
    setSeasonLabel,
    seasonBusy,
    seasonMsg,
    seasonErr,
    onSwitchSeasonAction,
  };
}