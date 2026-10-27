// app/admin/_parts/useSeasonSwitch.ts
"use client";

import { useAdminScope } from "@/lib/adminScope";
import { listScopedSeasons } from "@/lib/teamData";
import * as React from "react";
import type { Firestore } from "firebase/firestore";
import { createSeason, makeCurrentSeason } from "./adminActions";
import { listSeasons, type SeasonSummary } from "@/lib/seasonStore";
import type { Team } from "@/lib/branding";
import { invalidateSeasonList } from "@/components/season/SeasonSelector";

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
  teams: Team[] | null;
}) {
  const { db, uid, canEdit, currentSeasonId, fallbackTeamName, teams } = opts;
  const scope = useAdminScope();

  const [seasons, setSeasons] = React.useState<SeasonSummary[] | null>(null);
  const [seasonsVersion, setSeasonsVersion] = React.useState(0);

  const [seasonEditId, setSeasonEditId] = React.useState("");
  const [seasonTeamName, setSeasonTeamName] = React.useState("");
  const [seasonTeamId, setSeasonTeamId] = React.useState("");
  const [createTeamDocId, setCreateTeamDocId] = React.useState("");
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
    (scope ? listScopedSeasons(db, scope) : listSeasons(db))
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
  }, [scope, db, seasonsVersion]);

  const refreshSeasons = React.useCallback(() => {
    invalidateSeasonList();
    setSeasonsVersion((v) => v + 1);
  }, []);

  const onCreateSeasonAction = React.useCallback(async () => {
    if (!canEdit || seasonBusy) return;

    setSeasonBusy(true);
    setSeasonMsg(null);
    setSeasonErr(null);

    try {
      const { seasonId } = await createSeason({
        scope,
        db,
        uid: uid ?? "",
        seasonId: seasonEditId,
        existingSeasonIds: (seasons ?? []).map((s) => s.seasonId),
        teamName: seasonTeamName,
        teamId: seasonTeamId,
        team: teams?.find((t) => t.teamId === createTeamDocId) ?? null,
        seasonLabel,
        usesGamesPlayedRecord,
        scheduledGames: Number.parseInt(scheduledGames, 10) || 0,
        fallbackTeamName,
      });

      if (makeCurrentAfterCreate) {
        await makeCurrentSeason({ db, seasonId, uid: uid ?? undefined, scope });
        scope?.refresh();
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
    scope,
    canEdit,
    seasonBusy,
    db,
    uid,
    seasonEditId,
    seasons,
    seasonTeamName,
    seasonTeamId,
    teams,
    createTeamDocId,
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
      await makeCurrentSeason({ db, seasonId: target, uid: uid ?? undefined, scope });
      scope?.refresh();
      setSeasonMsg(
        `Current season set to ${scope ? (seasons?.find((x) => x.seasonId === target)?.seasonLabel ?? "the selected season") : target}. Its games, stats, and awards were not changed.`,
      );
      refreshSeasons();
    } catch (e: unknown) {
      setSeasonErr(errorText(e, "Failed to change the current season."));
    } finally {
      setSeasonBusy(false);
    }
  }, [
    scope,
    seasons,
    canEdit,
    seasonBusy,
    selectedCurrentId,
    currentSeasonId,
    db,
    uid,
    refreshSeasons,
  ]);

  return {
    seasons,
    refreshSeasons,
    seasonEditId,
    setSeasonEditId,
    seasonTeamName,
    setSeasonTeamName,
    seasonTeamId,
    setSeasonTeamId,
    createTeamDocId,
    setCreateTeamDocId,
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
