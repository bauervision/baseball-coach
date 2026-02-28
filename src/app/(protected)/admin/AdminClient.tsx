// app/admin/AdminClient.tsx
"use client";

import * as React from "react";

import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase.client";
import { useRosterPlayers, DEFAULT_SEASON_ID } from "@/lib/rosterStore";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";

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
import { RosterBuilderTab } from "./_parts/RosterBuilderTab";

export default function AdminClient() {
  const { seasonId, meta, players, error: rosterError } = useRosterPlayers();
  const effectiveSeasonId = seasonId || DEFAULT_SEASON_ID;

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

  const onSignInAction = React.useCallback(async () => {
    await signInAction(email, password, () => setPassword(""));
  }, [signInAction, email, password]);

  const game = useGameEntry({
    db,
    seasonId: effectiveSeasonId,
    players,
    canEdit,
  });

  const playerEdits = usePlayerEdits({
    db,
    seasonId: effectiveSeasonId,
    players,
    canEdit,
  });

  const seasonSwitch = useSeasonSwitch({
    db,
    canEdit,
    fallbackTeamName: meta.teamName || "Team",
  });

  const rosterDraft = useRosterDraft({
    db,
    seasonId: effectiveSeasonId,
    canEdit,
  });

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
          </div>

          <div className="flex flex-wrap gap-2">
            <TabButton
              label="Stat Update"
              active={tab === "stats"}
              onClickAction={() => setTab("stats")}
            />
            <TabButton
              label="Player Update"
              active={tab === "players"}
              onClickAction={() => setTab("players")}
            />
            <TabButton
              label="Season Update"
              active={tab === "season"}
              onClickAction={() => setTab("season")}
            />
          </div>

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
          canEdit={canEdit}
          rosterError={rosterError}
          players={players}
          lines={game.lines}
          playedCount={game.playedCount}
          hiddenCount={game.hiddenCount}
          date={game.date}
          setDateAction={game.setDate}
          opponent={game.opponent}
          setOpponentAction={game.setOpponent}
          result={game.result}
          setResultAction={game.setResult}
          scoreUs={game.scoreUs}
          setScoreUsAction={game.setScoreUs}
          scoreThem={game.scoreThem}
          setScoreThemAction={game.setScoreThem}
          setDeltaValueAction={game.setDeltaValue}
          toggleHiddenAction={game.toggleHidden}
          unhideAllAction={game.unhideAllAction}
          resetAllAction={game.resetAllAction}
          saving={game.saving}
          saveError={game.saveError}
          savedMsg={game.savedMsg}
          onSaveGameAction={game.onSaveGameAction}
        />
      ) : tab === "players" ? (
        <PlayersTab
          canEdit={canEdit}
          players={players}
          playerEdits={playerEdits.playerEdits}
          setPlayerEditValueAction={playerEdits.setPlayerEditValue}
          dirtyPlayersCount={playerEdits.dirtyPlayersCount}
          playerBusy={playerEdits.playerBusy}
          playerMsg={playerEdits.playerMsg}
          playerErr={playerEdits.playerErr}
          onSavePlayerEditsAction={playerEdits.onSavePlayerEditsAction}
        />
      ) : (
        <div className="grid gap-5">
          <SeasonTab
            canEdit={canEdit}
            seasonEditId={seasonSwitch.seasonEditId}
            setSeasonEditIdAction={seasonSwitch.setSeasonEditId}
            seasonTeamName={seasonSwitch.seasonTeamName}
            setSeasonTeamNameAction={seasonSwitch.setSeasonTeamName}
            seasonLabel={seasonSwitch.seasonLabel}
            setSeasonLabelAction={seasonSwitch.setSeasonLabel}
            teamNamePlaceholder={meta.teamName || "Team"}
            seasonBusy={seasonSwitch.seasonBusy}
            seasonMsg={seasonSwitch.seasonMsg}
            seasonErr={seasonSwitch.seasonErr}
            onSwitchSeasonAction={seasonSwitch.onSwitchSeasonAction}
          />

          <RosterBuilderTab
            canEdit={canEdit}
            seasonId={effectiveSeasonId}
            draft={rosterDraft.draft}
            setDraftAction={rosterDraft.setDraft}
            updateDraftRowAction={rosterDraft.updateDraftRow}
            insertRowAfterAction={rosterDraft.insertRowAfter}
            removeRowAction={rosterDraft.removeRow}
            rosterBusy={rosterDraft.rosterBusy}
            rosterMsg={rosterDraft.rosterMsg}
            rosterErr={rosterDraft.rosterErr}
            onRebuildRosterAction={rosterDraft.onRebuildRosterAction}
          />
        </div>
      )}
    </div>
  );
}