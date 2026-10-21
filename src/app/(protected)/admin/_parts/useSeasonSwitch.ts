// app/admin/_parts/useSeasonSwitch.ts
"use client";

import * as React from "react";
import type { Firestore } from "firebase/firestore";
import { createSeason, makeCurrentSeason } from "./adminActions";
import { listSeasons, type SeasonSummary } from "@/lib/seasonStore";

function errorText(e: unknown, fallback: string): string {
  return e && typeof e === "object" && "message" in e
    ? String((e as { message?: unknown }).message)
    : fallback;
}

export function useSeasonSwitch(opts: {
  db: Firestore;
  uid: string | null;
  canEdit: boolean;
  currentSeasonId: string;
  fallbackTeamName: string;
}) {
  const { db, uid, canEdit, currentSeasonId, fallbackTeamName } = opts;

  const [seasons, setSeasons] = React.useState<SeasonSummary[] | null>(null);
  const [seasonsVersion, setSeasonsVersion] = React.useState(0);

  const [seasonEditId, setSeasonEditId] = React.useState("");
  const [seasonTeamName, setSeasonTeamName] = React.useState("");
  const [seasonTeamId, setSeasonTeamId] = React.useState("");
  const [seasonLabel, setSeasonLabel] = React.useState("");
  const [usesGamesPlayedRecord, setUsesGamesPlayedRecord] =
    React.useState(false);
  const [scheduledGames, setScheduledGames] = React.useState("0");
  const [makeCurrentAfterCreate, setMakeCurrentAfterCreate] =
    React.useState(false);
  const [selectedCurrentId, setSelectedCurrentId] = React.useState("");

  const [seasonBusy, setSeasonBusy] = React.useState(false);
  const [seasonMsg, setSeasonMsg] = React.useState<string | null>(null);
  const [seasonErr, setSeasonErr] = React.useState<string | null>(null);
  const [lastCreatedSeasonId, setLastCreatedSeasonId] = React.useState<
    string | null
  >(null);

  React.useEffect(() => {
    let active = true;
    listSeasons(db)
      .then((list) => {
        if (active) setSeasons(list);
      })
      .catch((e: unknown) => {
        if (active) {
          setSeasons([]);
          setSeasonErr(errorText(e, "Failed to load seasons."));
        }
      });
    return () => {
      active = false;
    };
  }, [db, seasonsVersion]);

  const refreshSeasons = React.useCallback(
    () => setSeasonsVersion((v) => v + 1),
    [],
  );

  const onCreateSeasonAction = React.useCallback(async () => {
    if (!canEdit || seasonBusy) return;

    setSeasonBusy(true);
    setSeasonMsg(null);
    setSeasonErr(null);

    try {
      const { seasonId } = await createSeason({
        db,
        uid: uid ?? "",
        seasonId: seasonEditId,
        existingSeasonIds: (seasons ?? []).map((s) => s.seasonId),
        teamName: seasonTeamName,
        teamId: seasonTeamId,
        seasonLabel,
        usesGamesPlayedRecord,
        scheduledGames: Number.parseInt(scheduledGames, 10) || 0,
        fallbackTeamName,
      });

      if (makeCurrentAfterCreate) {
        await makeCurrentSeason({ db, seasonId });
      }

      setLastCreatedSeasonId(seasonId);
      setSeasonMsg(
        makeCurrentAfterCreate
          ? `Created ${seasonId} and made it the current season. Add players in Roster Builder below.`
          : `Created ${seasonId}. The current season is unchanged. Add players in Roster Builder below.`,
      );
      setSeasonEditId("");
      setSeasonLabel("");
      refreshSeasons();
    } catch (e: unknown) {
      setSeasonErr(errorText(e, "Failed to create season."));
    } finally {
      setSeasonBusy(false);
    }
  }, [
    canEdit,
    seasonBusy,
    db,
    uid,
    seasonEditId,
    seasons,
    seasonTeamName,
    seasonTeamId,
    seasonLabel,
    usesGamesPlayedRecord,
    scheduledGames,
    fallbackTeamName,
    makeCurrentAfterCreate,
    refreshSeasons,
  ]);

  const onMakeCurrentAction = React.useCallback(async () => {
    if (!canEdit || seasonBusy) return;
    const target = selectedCurrentId || "";
    if (!target || target === currentSeasonId) return;

    setSeasonBusy(true);
    setSeasonMsg(null);
    setSeasonErr(null);
    try {
      await makeCurrentSeason({ db, seasonId: target });
      setSeasonMsg(
        `Current season set to ${target}. No season data was changed.`,
      );
    } catch (e: unknown) {
      setSeasonErr(errorText(e, "Failed to change the current season."));
    } finally {
      setSeasonBusy(false);
    }
  }, [canEdit, seasonBusy, selectedCurrentId, currentSeasonId, db]);

  return {
    seasons,
    refreshSeasons,
    seasonEditId,
    setSeasonEditId,
    seasonTeamName,
    setSeasonTeamName,
    seasonTeamId,
    setSeasonTeamId,
    seasonLabel,
    setSeasonLabel,
    usesGamesPlayedRecord,
    setUsesGamesPlayedRecord,
    scheduledGames,
    setScheduledGames,
    makeCurrentAfterCreate,
    setMakeCurrentAfterCreate,
    selectedCurrentId,
    setSelectedCurrentId,
    seasonBusy,
    seasonMsg,
    seasonErr,
    lastCreatedSeasonId,
    onCreateSeasonAction,
    onMakeCurrentAction,
  };
}
