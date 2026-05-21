//src/app/player/PlayerPageClient.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  battingAverage,
  onBasePercentage,
  slugging,
  ops,
  fmt3,
  computeLeaders,
  type StatKey as LeaderStatKey,
} from "@/lib/roster";
import { useRosterPlayers } from "@/lib/rosterStore";
import { ArrowLeft } from "lucide-react";
import { computeTrophies, computeRunnerUpAwards } from "@/lib/trophies";

import { PlayerSeasonPlaque } from "@/components/player/PlayerSeasonPlaque";
import { pickPlayerBestGame } from "@/components/player/playerBestGame";
import { PlayerTrophyHero } from "@/components/player/PlayerTrophyHero";
import { BigStat, SmallStat } from "@/components/player/PlayerStatsCards";
import { GameLogRow } from "@/components/player/PlayerGameLog";
import {
  IconBat,
  IconDiamond,
  IconBall,
  IconScoreboard,
} from "@/components/player/helpers";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/Dialog";

import { usePlayerGameLog } from "@/components/roster/usePlayerGameLog";
import { AnimatedBackgroundSkin } from "@/components/shell/AnimatedBackgroundSkin";
import { exportPlayerStatsPdf } from "@/lib/exportPlayerStatsPdf";

type StatKey = "AVG" | "OBP" | "SLG" | "OPS";

const STAT_HELP: Record<
  StatKey,
  { title: string; description: string; formula: string; tip?: string }
> = {
  AVG: {
    title: "Batting Average",
    description:
      "How often a player gets a hit when they have an official at-bat.",
    formula: "Hits ÷ At-Bats",
    tip: "Simple: higher is better. Walks don’t count in AVG.",
  },
  OBP: {
    title: "On-Base Percentage",
    description:
      "How often a player reaches base (hit, walk, or hit by pitch).",
    formula: "(H + BB + HBP) ÷ Plate Appearances",
    tip: "Often a better getting on base metric than AVG.",
  },
  SLG: {
    title: "Slugging",
    description: "Measures power: extra-base hits count more than singles.",
    formula: "Total Bases ÷ At-Bats",
    tip: "Singles=1, Doubles=2, Triples=3, HR=4 in total bases.",
  },
  OPS: {
    title: "OPS",
    description:
      "Quick overall hitting number: getting on base plus hitting for power.",
    formula: "OBP + SLG",
    tip: "Easy comparison metric. Higher is better.",
  },
};

export default function PlayerPageClient() {
  const sp = useSearchParams();
  const id = (sp.get("id") ?? "").trim();

  const { seasonId, meta, players, error } = useRosterPlayers();

  const [activeStat, setActiveStat] = React.useState<StatKey | null>(null);
  const [viewMode, setViewMode] = React.useState<"plaque" | "season">("season");

  React.useEffect(() => {
    queueMicrotask(() => {
      setViewMode(meta.endSeasonMode ? "plaque" : "season");
    });
  }, [meta.endSeasonMode]);

  const player = React.useMemo(() => {
    const list = players ?? [];
    if (!id) return null;
    return list.find((p) => p.id === id) ?? null;
  }, [players, id]);

  const leaders = React.useMemo(() => computeLeaders(players ?? []), [players]);

  const isLeader = React.useCallback(
    (key: LeaderStatKey): boolean => {
      if (!player) return false;
      return leaders[key].includes(player.id);
    },
    [leaders, player],
  );

  const allTrophyAwards = React.useMemo(
    () =>
      computeTrophies(players ?? [], {
        endSeasonMode: meta.endSeasonMode,
        finalAwards: meta.finalAwards,
      }),
    [players, meta.endSeasonMode, meta.finalAwards],
  );

  const playerTrophyAwards = React.useMemo(() => {
    if (!player) return [];
    return allTrophyAwards.filter((award) =>
      award.leaders.some((leader) => leader.id === player.id),
    );
  }, [allTrophyAwards, player]);

  const playerRunnerUpAwards = React.useMemo(() => {
    if (!player) return [];

    return computeRunnerUpAwards(allTrophyAwards, player.id);
  }, [allTrophyAwards, player]);

  const {
    items: gameLog,
    loading: gameLogLoading,
    error: gameLogError,
  } = usePlayerGameLog({
    seasonId,
    playerId: player?.id ?? "",
  });

  const bestGame = React.useMemo(() => pickPlayerBestGame(gameLog), [gameLog]);

  const openStat = React.useCallback((k: StatKey) => setActiveStat(k), []);
  const closeStat = React.useCallback(() => setActiveStat(null), []);

  if (!id) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Player</CardTitle>
          <CardSubtitle>Missing player id</CardSubtitle>
        </CardHeader>
        <CardContent>
          <Link
            href="/"
            className="text-sm underline"
            style={{ color: "var(--muted)" }}
          >
            Back to roster
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Player</CardTitle>
          <CardSubtitle>Failed to load roster</CardSubtitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {error}
          </div>
          <Link
            href="/"
            className="text-sm underline"
            style={{ color: "var(--muted)" }}
          >
            Back to roster
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (players === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Player</CardTitle>
          <CardSubtitle>Loading…</CardSubtitle>
        </CardHeader>
        <CardContent>
          <Link
            href="/"
            className="text-sm underline"
            style={{ color: "var(--muted)" }}
          >
            Back to roster
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!player) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Player</CardTitle>
          <CardSubtitle>Player not found</CardSubtitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            No player matches id:{" "}
            <span style={{ color: "var(--foreground)" }}>{id}</span>
          </div>
          <Link
            href="/"
            className="text-sm underline"
            style={{ color: "var(--muted)" }}
          >
            Back to roster
          </Link>
        </CardContent>
      </Card>
    );
  }

  const ba = battingAverage(player);
  const obp = onBasePercentage(player);
  const slgV = slugging(player);
  const opsV = ops(player);

  const showingPlaque = meta.endSeasonMode && viewMode === "plaque";

  return (
    <>
      <AnimatedBackgroundSkin />
      <div className="relative z-10 grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold"
            style={{ color: "var(--muted)" }}
            aria-label="Back to roster"
          >
            <ArrowLeft
              size={20}
              strokeWidth={3}
              aria-hidden="true"
              style={{
                color:
                  "color-mix(in oklab, var(--foreground) 92%, var(--primary))",
              }}
            />
            <span>Back</span>
          </Link>

          {meta.endSeasonMode ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setViewMode("plaque")}
                className="rounded-xl border px-3 py-2 text-sm font-semibold"
                style={{
                  borderColor:
                    viewMode === "plaque"
                      ? "color-mix(in oklab, var(--secondary) 70%, transparent)"
                      : "color-mix(in oklab, var(--stroke) 92%, transparent)",
                  background:
                    viewMode === "plaque"
                      ? "linear-gradient(90deg, var(--primary), var(--secondary))"
                      : "color-mix(in oklab, var(--bg-base) 65%, transparent)",
                  color:
                    viewMode === "plaque" ? "rgba(0,0,0,0.92)" : "var(--muted)",
                }}
              >
                Plaque View
              </button>

              <button
                type="button"
                onClick={() => setViewMode("season")}
                className="rounded-xl border px-3 py-2 text-sm font-semibold"
                style={{
                  borderColor:
                    viewMode === "season"
                      ? "color-mix(in oklab, var(--secondary) 70%, transparent)"
                      : "color-mix(in oklab, var(--stroke) 92%, transparent)",
                  background:
                    viewMode === "season"
                      ? "linear-gradient(90deg, var(--primary), var(--secondary))"
                      : "color-mix(in oklab, var(--bg-base) 65%, transparent)",
                  color:
                    viewMode === "season" ? "rgba(0,0,0,0.92)" : "var(--muted)",
                }}
              >
                Season Stats
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {showingPlaque ? (
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-xl border px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-90 print:hidden"
                style={{
                  borderColor:
                    "color-mix(in oklab, var(--stroke) 92%, transparent)",
                  background:
                    "linear-gradient(90deg, var(--secondary), var(--primary))",
                  color: "rgba(0,0,0,0.92)",
                }}
              >
                Print Plaque
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                exportPlayerStatsPdf({
                  teamName: meta.teamName,
                  seasonLabel: meta.seasonLabel,
                  player,
                  awards: playerTrophyAwards,
                  leaders,
                })
              }
              className="rounded-xl border px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--stroke) 92%, transparent)",
                background:
                  "linear-gradient(90deg, var(--primary), var(--secondary))",
                color: "rgba(0,0,0,0.92)",
              }}
            >
              Print PDF
            </button>

            <div className="text-right">
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                {meta.teamName} • {meta.seasonLabel}
              </div>
            </div>
          </div>
        </div>

        {showingPlaque ? (
          <div
            data-player-plaque="true"
            className="mx-auto aspect-video h-[calc(100dvh-150px)] max-h-[1000px] min-h-[920px] w-full max-w-[1600px] overflow-hidden rounded-[32px] border print:h-auto print:max-h-none print:rounded-none"
          >
            <PlayerSeasonPlaque
              player={player}
              teamName={meta.teamName}
              seasonLabel={meta.seasonLabel}
              awards={playerTrophyAwards}
              runnerUpAwards={playerRunnerUpAwards}
              bestGame={bestGame}
              leaders={leaders}
            />
          </div>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div
                    className="text-3xl font-extrabold leading-none"
                    style={{ color: "var(--secondary)" }}
                  >
                    {player.name}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div
                    className="translate-y-0.5 text-5xl font-extrabold leading-none"
                    style={{ color: "var(--primary)" }}
                    aria-label={`Player number ${player.number}`}
                  >
                    {player.number}
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="grid gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <BigStat
                  label="Batting Average"
                  value={fmt3(ba)}
                  tone="primary"
                  leader={isLeader("avg")}
                  onExplainAction={() => openStat("AVG")}
                  icon={<IconBat />}
                />
                <BigStat
                  label="On-Base Percentage"
                  value={fmt3(obp)}
                  tone="accent"
                  leader={isLeader("obp")}
                  onExplainAction={() => openStat("OBP")}
                  icon={<IconDiamond />}
                />
                <BigStat
                  label="Slugging"
                  value={fmt3(slgV)}
                  tone="secondary"
                  leader={isLeader("slg")}
                  onExplainAction={() => openStat("SLG")}
                  icon={<IconBall />}
                />
                <BigStat
                  label="OPS"
                  value={fmt3(opsV)}
                  tone="accent2"
                  leader={isLeader("ops")}
                  onExplainAction={() => openStat("OPS")}
                  icon={<IconScoreboard />}
                />
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SmallStat
                  label="Games Played"
                  value={String(player.stats.games)}
                />
                <SmallStat
                  label="Plate Appearances"
                  value={String(player.stats.plateAppearances)}
                />
                <SmallStat
                  label="At Bats"
                  value={String(player.stats.atBats)}
                  leader={isLeader("atBats")}
                />
                <SmallStat
                  label="Hits"
                  value={String(player.stats.hits)}
                  leader={isLeader("hits")}
                />
                <SmallStat
                  label="Longest Hit Streak"
                  value={String(player.stats.longestHitStreak ?? 0)}
                  leader={isLeader("longestHitStreak")}
                />
                <SmallStat
                  label="Doubles"
                  value={String(player.stats.doubles)}
                  leader={isLeader("doubles")}
                />
                <SmallStat
                  label="Triples"
                  value={String(player.stats.triples)}
                  leader={isLeader("triples")}
                />
                <SmallStat
                  label="Home Runs"
                  value={String(player.stats.homeRuns)}
                  leader={isLeader("homeRuns")}
                />
                <SmallStat
                  label="RBIs: Runs Batted In"
                  value={String(player.stats.rbi)}
                  leader={isLeader("rbi")}
                />
                <SmallStat
                  label="Runs"
                  value={String(player.stats.runs)}
                  leader={isLeader("runs")}
                />
                <SmallStat
                  label="Base on Balls (Walk)"
                  value={String(player.stats.walks)}
                  leader={isLeader("walks")}
                />
                <SmallStat
                  label="Hit By Pitch"
                  value={String(player.stats.hitByPitch)}
                  leader={isLeader("hitByPitch")}
                />
                <SmallStat
                  label="Stolen Bases"
                  value={String(player.stats.stolenBases)}
                  leader={isLeader("stolenBases")}
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Defensive</CardTitle>
                  <CardSubtitle>
                    Fielding contributions (official scoring)
                  </CardSubtitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <SmallStat
                      label="Pitching Strike Outs"
                      value={String(player.stats.pitchingStrikeouts)}
                      leader={isLeader("pitchingStrikeouts")}
                    />
                    <SmallStat
                      label="Pitching Saves"
                      value={String(player.stats.pitchingSaves)}
                    />
                    <SmallStat
                      label="Fly Balls Caught"
                      value={String(player.stats.flyBallCatches)}
                    />
                    <SmallStat
                      label="Put Outs (PO)"
                      value={String(player.stats.putOuts)}
                      leader={isLeader("putOuts")}
                    />
                    <SmallStat
                      label="Assists (A)"
                      value={String(player.stats.assists)}
                      leader={isLeader("assists")}
                    />
                  </div>

                  <div
                    className="mt-3 text-xs"
                    style={{ color: "var(--muted)" }}
                  >
                    Example: SS → 1B groundout is an Assist for SS and Put Out
                    for 1B.
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Game Log</CardTitle>
                  <CardSubtitle>
                    Per-game batting lines for this season
                  </CardSubtitle>
                </CardHeader>

                <CardContent>
                  {gameLogLoading ? (
                    <div className="text-sm" style={{ color: "var(--muted)" }}>
                      Loading game log…
                    </div>
                  ) : gameLogError ? (
                    <div className="text-sm" style={{ color: "var(--muted)" }}>
                      {gameLogError}
                    </div>
                  ) : !gameLog || gameLog.length === 0 ? (
                    <div className="text-sm" style={{ color: "var(--muted)" }}>
                      No games recorded yet.
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {(() => {
                        const streakByGameId = new Map<string, number>();
                        let streak = 0;

                        [...gameLog]
                          .sort((a, b) => a.date.localeCompare(b.date))
                          .forEach((item) => {
                            const hadHit = item.delta.hits > 0;
                            streak = hadHit ? streak + 1 : 0;
                            streakByGameId.set(item.gameId, streak);
                          });

                        return gameLog.map((item) => (
                          <GameLogRow
                            key={item.gameId}
                            date={item.date}
                            opponent={item.opponent}
                            result={item.result}
                            scoreUs={item.scoreUs}
                            scoreThem={item.scoreThem}
                            atBats={item.delta.atBats}
                            hits={item.delta.hits}
                            runs={item.delta.runs}
                            rbi={item.delta.rbi}
                            walks={item.delta.walks}
                            hitByPitch={item.delta.hitByPitch}
                            hitStreak={streakByGameId.get(item.gameId) ?? 0}
                          />
                        ));
                      })()}
                    </div>
                  )}
                </CardContent>
              </Card>

              <PlayerTrophyHero
                playerName={player.name}
                awards={playerTrophyAwards}
                endSeasonMode={meta.endSeasonMode}
              />
            </CardContent>
          </Card>
        )}

        <Dialog
          open={activeStat !== null}
          onOpenChangeAction={(open) => {
            if (!open) closeStat();
          }}
        >
          <DialogContent
            title={activeStat ? STAT_HELP[activeStat].title : undefined}
            description={
              activeStat ? STAT_HELP[activeStat].description : undefined
            }
            className="max-w-md"
          >
            {activeStat ? (
              <div className="grid gap-3">
                <div
                  className="rounded-xl border px-3 py-2"
                  style={{
                    borderColor:
                      "color-mix(in oklab, var(--stroke) 92%, transparent)",
                    background:
                      "color-mix(in oklab, var(--bg-base) 65%, transparent)",
                  }}
                >
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--muted)" }}
                  >
                    Formula
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    {STAT_HELP[activeStat].formula}
                  </div>
                </div>

                {STAT_HELP[activeStat].tip ? (
                  <div className="text-sm" style={{ color: "var(--muted)" }}>
                    {STAT_HELP[activeStat].tip}
                  </div>
                ) : null}

                <DialogClose>
                  {({ close }) => (
                    <button
                      type="button"
                      onClick={close}
                      className="mt-1 rounded-xl border px-3 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 92%, transparent)",
                        background:
                          "linear-gradient(90deg, var(--primary), var(--secondary))",
                        color: "rgba(0,0,0,0.92)",
                      }}
                    >
                      Got it
                    </button>
                  )}
                </DialogClose>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
