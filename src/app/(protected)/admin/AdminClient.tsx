// app/(protected)/admin/AdminClient.tsx
"use client";

import * as React from "react";
import Link from "next/link";

import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase.client";
import { useRosterPlayers, DEFAULT_SEASON_ID } from "@/lib/rosterStore";
import { PLAYER_REGISTRY_ENABLED } from "@/lib/features";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";

import {
  FinalSeasonAwardsPanel,
  normalizeSeasonFinalState,
} from "./_parts/FinalSeasonAwardsPanel";

import type { AdminTab } from "./adminHelpers";
import { toastStyle } from "./adminHelpers";
import { Field, TabButton } from "./adminUiHelpers";

import { useAdminAuth } from "./_parts/useAdminAuth";
import { useGameEntry } from "./_parts/useGameEntry";
import { usePlayerEdits } from "./_parts/usePlayerEdits";
import { useSeasonSwitch } from "./_parts/useSeasonSwitch";
import { useRosterDraft } from "./_parts/useRosterDraft";

import { StatsTab } from "./_parts/StatsTab";
import { PlayersTab } from "./_parts/PlayersTab";
import { SeasonTab } from "./_parts/SeasonTab";
import { SeasonScheduleCard } from "./_parts/SeasonScheduleCard";
import { RosterBuilderTab } from "./_parts/RosterBuilderTab";
import { SeasonLifecycleCard } from "./_parts/SeasonLifecycleCard";
import { DISCARD_TEAM_PROMPT, TeamDesignerTab } from "./_parts/TeamDesignerTab";
import { listTeams } from "@/lib/teamStore";
import type { Team } from "@/lib/branding";
import { isFinalized } from "@/lib/seasonLifecycle";
import { LineupBuilderTab } from "./_parts/LineupBuilderTab";

export default function AdminClient() {
  const { seasonId, meta, players, error: rosterError } = useRosterPlayers();
  const effectiveSeasonId = seasonId || DEFAULT_SEASON_ID;
  const seasonFinalState = normalizeSeasonFinalState(meta);
  const [tab, setTab] = React.useState<AdminTab>("stats");

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  const auth = React.useMemo(() => getFirebaseAuth(), []);
  const db = React.useMemo(() => getFirestoreDb(), []);

  const {
    authReady,
    uid,
    isAllowlisted,
    canEdit,
    signingIn,
    signInError,
    signInAction,
  } = useAdminAuth({ auth, db });

  // The current season may be finalized (read-only, enforced by rules).
  // Season-specific editing uses this; lifecycle and season management
  // still use canEdit.
  const currentFinalized = isFinalized(meta);
  const canEditSeason = canEdit && !currentFinalized;

  const onSignInAction = React.useCallback(async () => {
    await signInAction(email, password, () => setPassword(""));
  }, [signInAction, email, password]);

  const game = useGameEntry({
    db,
    seasonId: effectiveSeasonId,
    players,
    canEdit: canEditSeason,
  });

  const playerEdits = usePlayerEdits({
    db,
    seasonId: effectiveSeasonId,
    players,
    canEdit: canEditSeason,
  });

  // Team identities (Team Designer, season creation). Head coach only.
  const [teams, setTeams] = React.useState<Team[] | null>(null);
  const [teamsVersion, setTeamsVersion] = React.useState(0);
  const refreshTeams = React.useCallback(() => setTeamsVersion((v) => v + 1), []);
  React.useEffect(() => {
    if (!canEdit) return;
    let active = true;
    listTeams(db)
      .then((list) => {
        if (active) setTeams(list);
      })
      .catch(() => {
        if (active) setTeams([]);
      });
    return () => {
      active = false;
    };
  }, [db, canEdit, teamsVersion]);

  // Leaving the Team Designer with unsaved changes asks first.
  const [teamDirty, setTeamDirty] = React.useState(false);
  const goTab = React.useCallback(
    (next: AdminTab) => {
      if (tab === "team" && next !== "team" && teamDirty && !window.confirm(DISCARD_TEAM_PROMPT)) {
        return;
      }
      if (next !== "team") setTeamDirty(false);
      setTab(next);
    },
    [tab, teamDirty],
  );

  const seasonSwitch = useSeasonSwitch({
    db,
    uid,
    canEdit,
    currentSeasonId: effectiveSeasonId,
    fallbackTeamName: meta.teamName || "Team",
    teams,
  });

  const rosterDraft = useRosterDraft({
    db,
    uid,
    seasons: seasonSwitch.seasons,
    defaultSeasonId: effectiveSeasonId,
    canEdit,
  });

  // After creating a season, point the roster builder at it.
  const { lastCreatedSeasonId } = seasonSwitch;
  const { setTargetSeasonId } = rosterDraft;
  React.useEffect(() => {
    if (lastCreatedSeasonId) setTargetSeasonId(lastCreatedSeasonId);
  }, [lastCreatedSeasonId, setTargetSeasonId]);

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Admin</CardTitle>
          <CardSubtitle>Sign in and manage the current season.</CardSubtitle>
        </CardHeader>

        <CardContent className="grid gap-4">
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            Current season id:{" "}
            <span style={{ color: "var(--foreground)", fontWeight: 700 }}>
              {effectiveSeasonId}
            </span>
            {PLAYER_REGISTRY_ENABLED ? (
              <>
                {" · "}
                <Link href="/profile" className="underline">
                  My Players
                </Link>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <TabButton
              label="Stat Update"
              active={tab === "stats"}
              onClickAction={() => goTab("stats")}
            />
            <TabButton
              label="Lineup"
              active={tab === "lineup"}
              onClickAction={() => goTab("lineup")}
            />
            <TabButton
              label="Player Update"
              active={tab === "players"}
              onClickAction={() => goTab("players")}
            />
            <TabButton
              label="Season Update"
              active={tab === "season"}
              onClickAction={() => goTab("season")}
            />
            <TabButton
              label="Team Designer"
              active={tab === "team"}
              onClickAction={() => goTab("team")}
            />
          </div>

          {currentFinalized ? (
            <div className="rounded-xl border px-3 py-2 text-xs" role="status" style={toastStyle("err")}>
              {meta.seasonLabel} is finalized, so its games, roster, lineup,
              and awards are read-only. Reopen it under Season Update, or
              make another season current.
            </div>
          ) : null}

          {!authReady ? (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Checking auth…
            </div>
          ) : uid === null ? (
            <div className="grid gap-3">
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Sign in (Firebase Auth) to update stats.
              </div>

              {signInError ? (
                <div
                  className="rounded-xl border px-3 py-2 text-xs"
                  style={toastStyle("err")}
                >
                  {signInError}
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <Field
                  label="Email"
                  value={email}
                  onChangeAction={setEmail}
                  type="email"
                />
                <Field
                  label="Password"
                  value={password}
                  onChangeAction={setPassword}
                  type="password"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onSignInAction}
                  disabled={signingIn}
                  className="rounded-xl border px-3 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{
                    borderColor:
                      "color-mix(in oklab, var(--stroke) 92%, transparent)",
                    background:
                      "linear-gradient(90deg, var(--primary), var(--secondary))",
                    color: "rgba(0,0,0,0.92)",
                  }}
                >
                  {signingIn ? "Signing in…" : "Sign in"}
                </button>
              </div>
            </div>
          ) : isAllowlisted === false ? (
            <div className="grid gap-2">
              <div className="text-sm font-semibold">
                Signed in, but not allowlisted.
              </div>
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Add a document at <code>admins/{uid}</code> to enable admin
                access.
              </div>
            </div>
          ) : isAllowlisted === null ? (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Checking admin allowlist…
            </div>
          ) : (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Signed in and allowlisted.
            </div>
          )}
        </CardContent>
      </Card>

      {tab === "stats" ? (
        <StatsTab
          canEdit={canEditSeason}
          rosterError={rosterError}
          players={players}
          orderedPlayers={game.orderedPlayers}
          lines={game.lines}
          playedCount={game.playedCount}
          hiddenCount={game.hiddenCount}
          date={game.date}
          setDateAction={game.setDate}
          opponent={game.opponent}
          setOpponentAction={game.setOpponent}
          result={game.result}
          setResultAction={game.setResult}
          gameType={game.gameType}
          setGameTypeAction={game.setGameType}
          scoreUs={game.scoreUs}
          setScoreUsAction={game.setScoreUs}
          scoreThem={game.scoreThem}
          setScoreThemAction={game.setScoreThem}
          savedGames={game.savedGames}
          gamesLoading={game.gamesLoading}
          loadingGame={game.loadingGame}
          editingGameId={game.editingGameId}
          loadExistingGameAction={game.requestLoadGameAction}
          unsavedPlayerIds={game.unsavedPlayerIds}
          activeEditPlayerId={game.activeEditPlayerId}
          setDeltaValueAction={game.setDeltaValue}
          toggleHiddenAction={game.toggleHidden}
          unhideAllAction={game.unhideAllAction}
          resetAllAction={game.requestResetAction}
          saving={game.saving}
          saveError={game.saveError}
          savedMsg={game.savedMsg}
          onSaveGameAction={game.onSaveGameAction}
          coachPicks={game.coachPicks}
          setCoachPickAction={game.setCoachPickAction}
          gameBallPlayerId={game.gameBallPlayerId}
          gameBallGroups={game.gameBallGroups}
          setGameBallPlayerIdAction={game.setGameBallPlayerIdAction}
        />
      ) : tab === "players" ? (
        <PlayersTab
          canEdit={canEditSeason}
          players={players}
          playerEdits={playerEdits.playerEdits}
          setPlayerEditValueAction={playerEdits.setPlayerEditValue}
          dirtyPlayersCount={playerEdits.dirtyPlayersCount}
          playerBusy={playerEdits.playerBusy}
          playerMsg={playerEdits.playerMsg}
          playerErr={playerEdits.playerErr}
          onSavePlayerEditsAction={playerEdits.onSavePlayerEditsAction}
          onRemovePlayerAction={playerEdits.onRemovePlayerAction}
        />
      ) : tab === "team" ? (
        <TeamDesignerTab
          db={db}
          canEdit={canEdit}
          teams={teams}
          seasons={seasonSwitch.seasons}
          onTeamsChangedAction={refreshTeams}
          onSeasonsChangedAction={seasonSwitch.refreshSeasons}
          onDirtyChangeAction={setTeamDirty}
        />
      ) : tab === "lineup" ? (
        <LineupBuilderTab
          db={db}
          seasonId={effectiveSeasonId}
          players={players}
          canEdit={canEditSeason}
          teamName={meta.teamName}
          seasonLabel={meta.seasonLabel}
        />
      ) : (
        <div className="grid gap-5">
          <SeasonScheduleCard
            db={db}
            seasonId={effectiveSeasonId}
            canEdit={canEditSeason}
            scheduledGames={meta.scheduledGames}
            gamesPlayed={meta.gamesPlayed}
          />
          <SeasonTab
            canEdit={canEdit}
            currentSeasonId={effectiveSeasonId}
            seasons={seasonSwitch.seasons}
            seasonEditId={seasonSwitch.seasonEditId}
            setSeasonEditIdAction={seasonSwitch.setSeasonEditId}
            seasonTeamName={seasonSwitch.seasonTeamName}
            setSeasonTeamNameAction={seasonSwitch.setSeasonTeamName}
            seasonTeamId={seasonSwitch.seasonTeamId}
            setSeasonTeamIdAction={seasonSwitch.setSeasonTeamId}
            teams={teams}
            createTeamDocId={seasonSwitch.createTeamDocId}
            setCreateTeamDocIdAction={seasonSwitch.setCreateTeamDocId}
            seasonLabel={seasonSwitch.seasonLabel}
            setSeasonLabelAction={seasonSwitch.setSeasonLabel}
            usesGamesPlayedRecord={seasonSwitch.usesGamesPlayedRecord}
            setUsesGamesPlayedRecordAction={
              seasonSwitch.setUsesGamesPlayedRecord
            }
            scheduledGames={seasonSwitch.scheduledGames}
            setScheduledGamesAction={seasonSwitch.setScheduledGames}
            makeCurrentAfterCreate={seasonSwitch.makeCurrentAfterCreate}
            setMakeCurrentAfterCreateAction={
              seasonSwitch.setMakeCurrentAfterCreate
            }
            selectedCurrentId={seasonSwitch.selectedCurrentId}
            setSelectedCurrentIdAction={seasonSwitch.setSelectedCurrentId}
            teamNamePlaceholder={meta.teamName || "Team"}
            seasonBusy={seasonSwitch.seasonBusy}
            seasonMsg={seasonSwitch.seasonMsg}
            seasonErr={seasonSwitch.seasonErr}
            onCreateSeasonAction={seasonSwitch.onCreateSeasonAction}
            onMakeCurrentAction={seasonSwitch.onMakeCurrentAction}
          />
          <SeasonLifecycleCard
            db={db}
            uid={uid}
            canEdit={canEdit}
            seasons={seasonSwitch.seasons}
            currentSeasonId={effectiveSeasonId}
            onChangedAction={seasonSwitch.refreshSeasons}
          />
          <FinalSeasonAwardsPanel
            db={db}
            seasonId={effectiveSeasonId}
            canEdit={canEditSeason}
            players={players}
            endSeasonMode={seasonFinalState.endSeasonMode}
            finalAwards={seasonFinalState.finalAwards}
          />
          <RosterBuilderTab
            canEdit={canEdit}
            seasons={seasonSwitch.seasons}
            roster={rosterDraft}
          />
        </div>
      )}
    </div>
  );
}
