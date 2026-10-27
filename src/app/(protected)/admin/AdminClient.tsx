// app/(protected)/admin/AdminClient.tsx
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase.client";
import { useRosterPlayers, DEFAULT_SEASON_ID } from "@/lib/rosterStore";
import { googleLinkEnabled, PLAYER_REGISTRY_ENABLED } from "@/lib/features";
import { LinkGoogleCard } from "@/components/auth/LinkGoogleCard";

import {
  Card,
  CardContent,
} from "@/components/ui/Card";

import {
  FinalSeasonAwardsPanel,
  normalizeSeasonFinalState,
} from "./_parts/FinalSeasonAwardsPanel";

import type { AdminTab } from "./adminHelpers";
import { toastStyle } from "./adminHelpers";
import { Field } from "./adminUiHelpers";
import { AdminWorkspaceHeader } from "./_parts/AdminWorkspaceHeader";

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
import { DraftSeasonsCard } from "./_parts/DraftSeasonsCard";
import { DISCARD_TEAM_PROMPT, TeamDesignerTab } from "./_parts/TeamDesignerTab";
import { listTeams, teamAccessMessage } from "@/lib/teamStore";
import type { Team } from "@/lib/branding";
import { isFinalized } from "@/lib/seasonLifecycle";
import { LineupBuilderTab } from "./_parts/LineupBuilderTab";
import { LEAVE_SETUP_PROMPT, SeasonSetupWizard } from "./_parts/SeasonSetupWizard";
import { setupHref } from "@/lib/seasonSetup";
import { invalidateSeasonList } from "@/components/season/SeasonSelector";
import { Button } from "@/components/ui/Button";
import { adminHref, useAdminScope } from "@/lib/adminScope";
import { TeamWithoutSeason } from "./_parts/TeamWithoutSeason";
import { PlayerPagesCard } from "./_parts/PlayerPagesCard";

export default function AdminClient() {
  // Tallies: inside a selected team every read and write is scoped to it
  // (useAdminScope); the season is the team's own current season and never
  // the legacy default. A team without a current season gets setup instead.
  const scope = useAdminScope();
  if (scope && !scope.team?.currentSeasonId) return <TeamWithoutSeason />;
  return <AdminWorkspace />;
}

function AdminWorkspace() {
  const scope = useAdminScope();
  const { seasonId, meta, players, error: rosterError } = useRosterPlayers();
  const effectiveSeasonId = seasonId || (scope?.team?.currentSeasonId ?? DEFAULT_SEASON_ID);
  const seasonFinalState = normalizeSeasonFinalState(meta);
  // ?tab=lineup opens the Lineup Builder (e.g. right after setup makes the
  // first season current, which swaps in this view).
  const initialTab = useSearchParams().get("tab") === "lineup" ? "lineup" : "stats";
  const [tab, setTab] = React.useState<AdminTab>(initialTab);

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

  // "Link Google account" (feature-gated; decided after mount so the static
  // HTML never differs).
  const [showGoogleLink, setShowGoogleLink] = React.useState(false);
  React.useEffect(() => setShowGoogleLink(googleLinkEnabled()), []);

  // Team identities (Team Designer, season creation). Head coach only.
  const [teams, setTeams] = React.useState<Team[] | null>(null);
  // A failed load is shown, never treated as "no teams".
  const [teamsError, setTeamsError] = React.useState<string | null>(null);
  const [teamsVersion, setTeamsVersion] = React.useState(0);
  const refreshTeams = React.useCallback(() => {
    setTeamsVersion((v) => v + 1);
    scope?.refresh();
  }, [scope]);
  React.useEffect(() => {
    if (!canEdit) return;
    let active = true;
    listTeams(db, scope)
      .then((list) => {
        if (!active) return;
        setTeams(list);
        setTeamsError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setTeams([]);
        setTeamsError(teamAccessMessage(e, "Could not load teams."));
      });
    return () => {
      active = false;
    };
  }, [db, canEdit, teamsVersion, scope]);

  // Guided New Season Setup lives in the URL (?setup=1&step=…), so it
  // survives refresh and back/forward. Any Admin tab leaves it.
  const router = useRouter();
  const searchParams = useSearchParams();
  const setupActive = searchParams.get("setup") === "1";
  const adminHome = adminHref(scope);
  const [setupDirty, setSetupDirty] = React.useState(false);

  // Leaving the Team Designer (or setup) with unsaved changes asks first.
  const [teamDirty, setTeamDirty] = React.useState(false);
  const goTab = React.useCallback(
    (next: AdminTab) => {
      if (setupActive) {
        if (setupDirty && !window.confirm(LEAVE_SETUP_PROMPT)) return;
        setSetupDirty(false);
        router.push(adminHome);
        setTab(next);
        return;
      }
      if (tab === "team" && next !== "team" && teamDirty && !window.confirm(DISCARD_TEAM_PROMPT)) {
        return;
      }
      if (next !== "team") setTeamDirty(false);
      setTab(next);
    },
    [tab, teamDirty, setupActive, setupDirty, router, adminHome],
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
      <AdminWorkspaceHeader
        teamLine={[meta.league, meta.teamName].filter(Boolean).join(" ")}
        seasonLabel={meta.seasonLabel}
        seasonId={effectiveSeasonId}
        activeTab={setupActive ? null : tab}
        onSelectAction={goTab}
        ready={authReady && uid !== null && isAllowlisted === true}
        myPlayersHref={PLAYER_REGISTRY_ENABLED && !scope ? "/profile" : null}
      >
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
          ) : null}
        {showGoogleLink && !scope && authReady && uid !== null && isAllowlisted === true ? <LinkGoogleCard auth={auth} /> : null}
      </AdminWorkspaceHeader>

      {setupActive ? (
        <SeasonSetupWizard
          db={db}
          uid={uid}
          canEdit={canEdit}
          teams={teams}
          teamsError={teamsError}
          seasons={seasonSwitch.seasons}
          currentSeasonId={effectiveSeasonId}
          onTeamsChangedAction={refreshTeams}
          onSeasonsChangedAction={seasonSwitch.refreshSeasons}
          onDirtyChangeAction={setSetupDirty}
          onExitAction={() => {
            setSetupDirty(false);
            router.push(adminHome);
            setTab("season");
          }}
          onOpenLineupAction={() => {
            setSetupDirty(false);
            router.push(adminHome);
            setTab("lineup");
          }}
        />
      ) : tab === "stats" ? (
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
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold">New season setup</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  Team → Season → Roster → Ready. Creates a draft season; your
                  current season stays current until you choose otherwise.
                </div>
              </div>
              <Button
                disabled={!canEdit}
                onClick={() =>
                  router.push(scope?.team ? setupHref({ step: "season", team: scope.team.teamId }) : setupHref({ step: "team" }))
                }
              >
                Start setup
              </Button>
            </CardContent>
          </Card>
          <SeasonScheduleCard
            db={db}
            seasonId={effectiveSeasonId}
            canEdit={canEditSeason}
            scheduledGames={meta.scheduledGames}
            gamesPlayed={meta.gamesPlayed}
          />
          <SeasonTab
            hideCreate={!!scope}
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
          <DraftSeasonsCard
            db={db}
            uid={uid}
            canEdit={canEdit}
            seasons={seasonSwitch.seasons}
            currentSeasonId={effectiveSeasonId}
            onDeletedAction={() => {
              seasonSwitch.refreshSeasons();
              invalidateSeasonList();
            }}
          />
          <FinalSeasonAwardsPanel
            db={db}
            seasonId={effectiveSeasonId}
            canEdit={canEditSeason}
            players={players}
            endSeasonMode={seasonFinalState.endSeasonMode}
            finalAwards={seasonFinalState.finalAwards}
          />
          {scope ? <PlayerPagesCard seasonId={effectiveSeasonId} players={players} /> : null}
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
