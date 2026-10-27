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
import { useViewedSeasonId } from "@/lib/viewedSeason";
import { useSeasonLinks } from "@/lib/seasonLinks";
import { useTeamScope } from "@/lib/teamScope";
import { useAdminScope } from "@/lib/adminScope";
import { isFinalized } from "@/lib/seasonLifecycle";
import { SeasonSelector } from "@/components/season/SeasonSelector";
import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase.client";
import { loadCareerSummary, loadPublicCareer, type CareerSummary } from "@/lib/playerCareerStats";
import { ArrowLeft } from "lucide-react";
import { computeTrophies, computeRunnerUpAwards } from "@/lib/trophies";

import { buildRecognitionCards } from "@/components/player/PlayerSeasonPlaque";
import {
  RECOGNITION_PRINT_SHEET_ID,
  RecognitionPrintRoot,
  RecognitionSheetStage,
} from "@/components/player/RecognitionSheetEditor";
import { pickPlayerBestGame } from "@/components/player/playerBestGame";
import { PlayerTrophyHero } from "@/components/player/PlayerTrophyHero";
import { PlayerCareerHistory } from "@/components/player/PlayerCareerHistory";
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
import { gameLogHitStreaks } from "@/lib/playerGameLog";
import { computeWithinReach, type WithinReachKey } from "@/lib/withinReach";

import { AnimatedBackgroundSkin } from "@/components/shell/AnimatedBackgroundSkin";
import { exportPlayerStatsPdf } from "@/lib/exportPlayerStatsPdf";
import { exportRecognitionSheetPdf } from "@/lib/exportRecognitionSheetPdf";
import { sameOrder } from "@/lib/recognitionLayout";
import {
  resetRecognitionLayout,
  saveRecognitionLayout,
} from "@/lib/recognitionLayoutStore";
import { useAdminAuth } from "@/app/(protected)/admin/_parts/useAdminAuth";

const DISCARD_ARRANGEMENT_PROMPT = "Discard your unsaved award arrangement?";

function errorMessage(e: unknown, fallback: string): string {
  return e && typeof e === "object" && "message" in e
    ? String((e as { message?: unknown }).message)
    : fallback;
}

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
  // Team routes carry the player in the path; legacy pages in ?id=.
  const scope = useTeamScope();
  const id = scope.inTeam ? (scope.route?.playerId ?? "") : (sp.get("id") ?? "").trim();
  const links = useSeasonLinks();
  const adminScope = useAdminScope();

  // The viewed season (?season=) drives everything on this page: stats,
  // game log, awards, saved arrangement, recognition sheet, and PDF.
  const viewedSeasonParam = useViewedSeasonId();
  const { seasonId, activeSeasonId, meta, players, error } =
    useRosterPlayers(viewedSeasonParam);
  const homeHref = links.home(viewedSeasonParam);

  const [activeStat, setActiveStat] = React.useState<StatKey | null>(null);
  const [viewMode, setViewMode] = React.useState<"plaque" | "season">("season");
  const [statsView, setStatsView] = React.useState<"season" | "career">(
    "season",
  );
  const [career, setCareer] = React.useState<CareerSummary | null>(null);
  const careerStats = career?.totals ?? null;
  const hasCareer = (career?.history.length ?? 0) > 1;
  const [careerStatsLoading, setCareerStatsLoading] = React.useState(false);

  const auth = React.useMemo(() => getFirebaseAuth(), []);
  const db = React.useMemo(() => getFirestoreDb(), []);
  const { canEdit: isCoach } = useAdminAuth({ auth, db });
  // Finalized seasons are read-only (also enforced by Firestore rules).
  // Parents' team pages never show coach controls, even to the coach.
  const canEdit = !links.publicView && isCoach && !isFinalized(meta);

  // Recognition sheet arrangement: `draftOrder` is non-null while editing.
  const [draftOrder, setDraftOrder] = React.useState<string[] | null>(null);
  const [arrangeBusy, setArrangeBusy] = React.useState(false);
  const [arrangeMsg, setArrangeMsg] = React.useState<string | null>(null);
  const [arrangeErr, setArrangeErr] = React.useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = React.useState(false);

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

  React.useEffect(() => {
    setStatsView("season");
    setCareer(null);
  }, [seasonId, player?.id]);

  // Career follows the permanent identity (careerPlayerId) and only
  // explicitly linked seasons; names are never matched.
  const { teamName, seasonLabel, endSeasonMode, finalAwards } = meta;
  // Parents' pages and the Tallies coach area follow the public careerLinks
  // (identity data is private there); the legacy app scans careerPlayerId.
  const publicCareer = links.publicView || adminScope !== null;
  React.useEffect(() => {
    if (!player || !seasonId) return;
    if (publicCareer ? !player.careerLinks?.length : !player.careerPlayerId) return;

    let active = true;
    setCareerStatsLoading(true);

    void (publicCareer ? loadPublicCareer : loadCareerSummary)({
      db: getFirestoreDb(),
      seasonId,
      player,
      currentSeason: { teamName, seasonLabel, endSeasonMode, finalAwards },
    })
      .then((summary) => {
        if (active) setCareer(summary);
      })
      .catch(() => {
        if (active) setCareer(null);
      })
      .finally(() => {
        if (active) setCareerStatsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [player, seasonId, teamName, seasonLabel, endSeasonMode, finalAwards, publicCareer]);

  const playerHrefForSeason = React.useCallback(
    (targetSeasonId: string) => {
      const row = career?.history.find((h) => h.seasonId === targetSeasonId);
      if (targetSeasonId === seasonId && player) {
        return links.player(targetSeasonId, player.id, activeSeasonId);
      }
      return row
        ? links.player(targetSeasonId, row.seasonPlayerId, activeSeasonId, row.teamId)
        : links.home(targetSeasonId, activeSeasonId);
    },
    [career, seasonId, player, activeSeasonId, links],
  );

  const leaders = React.useMemo(() => computeLeaders(players ?? []), [players]);

  const isLeader = React.useCallback(
    (key: LeaderStatKey): boolean => {
      if (!player) return false;
      return leaders[key].includes(player.id);
    },
    [leaders, player],
  );

  // "N behind leader" gaps, derived from the same leaders as LEAD and
  // recomputed whenever roster stats change.
  const withinReach = React.useMemo(
    () => (player ? computeWithinReach(players ?? [], player.id, leaders) : {}),
    [players, player, leaders],
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

  const savedOrder = player
    ? (meta.recognitionLayouts[player.id] ?? null)
    : null;
  const recognition = React.useMemo(
    () =>
      buildRecognitionCards({
        player,
        awards: playerTrophyAwards,
        runnerUpAwards: playerRunnerUpAwards,
        savedOrder,
      }),
    [player, playerTrophyAwards, playerRunnerUpAwards, savedOrder],
  );
  const editingArrangement = draftOrder !== null;
  const arrangementDirty =
    draftOrder !== null && !sameOrder(draftOrder, recognition.order);

  React.useEffect(() => {
    setDraftOrder(null);
    setArrangeMsg(null);
    setArrangeErr(null);
  }, [player?.id, seasonId]);

  React.useEffect(() => {
    if (!arrangementDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [arrangementDirty]);

  const confirmDiscardArrangement = React.useCallback(
    () => !arrangementDirty || window.confirm(DISCARD_ARRANGEMENT_PROMPT),
    [arrangementDirty],
  );

  const startArrangingAction = React.useCallback(() => {
    setArrangeMsg(null);
    setArrangeErr(null);
    setDraftOrder(recognition.order);
  }, [recognition.order]);

  const cancelArrangingAction = React.useCallback(() => {
    if (!confirmDiscardArrangement()) return;
    setDraftOrder(null);
    setArrangeErr(null);
  }, [confirmDiscardArrangement]);

  const saveArrangementAction = React.useCallback(async () => {
    if (!player || !draftOrder || arrangeBusy) return;
    setArrangeBusy(true);
    setArrangeErr(null);
    setArrangeMsg(null);

    try {
      // Saving the automatic order stores no override, so the sheet keeps
      // following the automatic arrangement as awards change.
      if (sameOrder(draftOrder, recognition.autoOrder)) {
        await resetRecognitionLayout({ db, seasonId, playerId: player.id });
      } else {
        await saveRecognitionLayout({
          db,
          seasonId,
          playerId: player.id,
          order: draftOrder,
        });
      }
      setDraftOrder(null);
      setArrangeMsg("Award arrangement saved.");
    } catch (e: unknown) {
      setArrangeErr(errorMessage(e, "Failed to save award arrangement."));
    } finally {
      setArrangeBusy(false);
    }
  }, [arrangeBusy, db, draftOrder, player, recognition.autoOrder, seasonId]);

  const exportPlaquePdfAction = React.useCallback(async () => {
    const node = document.getElementById(RECOGNITION_PRINT_SHEET_ID);
    if (!node || !player || pdfBusy) return;
    setPdfBusy(true);
    try {
      await exportRecognitionSheetPdf({
        node,
        fileName: `${player.name.replace(/[^a-z0-9]+/gi, "-")}-recognition.pdf`,
      });
    } catch (e: unknown) {
      setArrangeErr(errorMessage(e, "Failed to create the PDF."));
    } finally {
      setPdfBusy(false);
    }
  }, [pdfBusy, player]);

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
            href={homeHref}
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
            href={homeHref}
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
            href={homeHref}
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
            href={homeHref}
            className="text-sm underline"
            style={{ color: "var(--muted)" }}
          >
            Back to roster
          </Link>
        </CardContent>
      </Card>
    );
  }

  const displayedPlayer =
    statsView === "career" && careerStats
      ? { ...player, stats: careerStats }
      : player;
  // Leaders are season-based, so gaps only make sense on season stats.
  const reach = (key: WithinReachKey): number | null =>
    displayedPlayer === player ? (withinReach[key] ?? null) : null;
  const ba = battingAverage(displayedPlayer);
  const obp = onBasePercentage(displayedPlayer);
  const slgV = slugging(displayedPlayer);
  const opsV = ops(displayedPlayer);

  const showingPlaque = meta.endSeasonMode && viewMode === "plaque";
  const sheetOrder = draftOrder ?? savedOrder;
  const sheetProps = {
    player,
    teamName: meta.teamName,
    seasonLabel: meta.seasonLabel,
    awards: playerTrophyAwards,
    runnerUpAwards: playerRunnerUpAwards,
    bestGame,
    leaders,
  };

  return (
    <>
      <AnimatedBackgroundSkin />
      <div className="relative z-10 grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={homeHref}
            className="inline-flex items-center gap-2 text-sm font-semibold"
            style={{ color: "var(--muted)" }}
            aria-label="Back to roster"
            onClick={(e) => {
              if (!confirmDiscardArrangement()) e.preventDefault();
            }}
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
                onClick={() => {
                  if (!confirmDiscardArrangement()) return;
                  setDraftOrder(null);
                  setViewMode("season");
                }}
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

          {hasCareer ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStatsView("season")}
                className="rounded-xl border px-3 py-2 text-sm font-semibold"
                style={{
                  borderColor:
                    statsView === "season"
                      ? "color-mix(in oklab, var(--secondary) 70%, transparent)"
                      : "color-mix(in oklab, var(--stroke) 92%, transparent)",
                  background:
                    statsView === "season"
                      ? "linear-gradient(90deg, var(--primary), var(--secondary))"
                      : "color-mix(in oklab, var(--bg-base) 65%, transparent)",
                  color:
                    statsView === "season"
                      ? "rgba(0,0,0,0.92)"
                      : "var(--muted)",
                }}
              >
                Current Season
              </button>

              <button
                type="button"
                onClick={() => setStatsView("career")}
                disabled={careerStatsLoading}
                className="rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-60"
                style={{
                  borderColor:
                    statsView === "career"
                      ? "color-mix(in oklab, var(--secondary) 70%, transparent)"
                      : "color-mix(in oklab, var(--stroke) 92%, transparent)",
                  background:
                    statsView === "career"
                      ? "linear-gradient(90deg, var(--primary), var(--secondary))"
                      : "color-mix(in oklab, var(--bg-base) 65%, transparent)",
                  color:
                    statsView === "career"
                      ? "rgba(0,0,0,0.92)"
                      : "var(--muted)",
                }}
              >
                {careerStatsLoading ? "Loading Career Stats…" : "Career Stats"}
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {showingPlaque && canEdit && !editingArrangement ? (
              <button
                type="button"
                onClick={startArrangingAction}
                className="rounded-xl border px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
                style={{
                  borderColor:
                    "color-mix(in oklab, var(--secondary) 70%, transparent)",
                  background:
                    "color-mix(in oklab, var(--bg-base) 65%, transparent)",
                  color: "var(--foreground)",
                }}
              >
                Arrange Awards
              </button>
            ) : null}
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
            {showingPlaque || displayedPlayer.stats.games > 0 ? (
              <button
                type="button"
                disabled={pdfBusy}
                onClick={() =>
                  showingPlaque
                    ? void exportPlaquePdfAction()
                    : exportPlayerStatsPdf({
                        teamName: meta.teamName,
                        seasonLabel: meta.seasonLabel,
                        player: displayedPlayer,
                        awards: playerTrophyAwards,
                        leaders,
                      })
                }
                className="rounded-xl border px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{
                  borderColor:
                    "color-mix(in oklab, var(--stroke) 92%, transparent)",
                  background:
                    "linear-gradient(90deg, var(--primary), var(--secondary))",
                  color: "rgba(0,0,0,0.92)",
                }}
              >
                {pdfBusy ? "Creating PDF…" : "Print PDF"}
              </button>
            ) : null}

            <SeasonSelector
              viewedSeasonId={seasonId}
              activeSeasonId={activeSeasonId}
              hrefFor={playerHrefForSeason}
            />

            <div className="text-right">
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                {meta.teamName} • {meta.seasonLabel}
              </div>
            </div>
          </div>
        </div>

        {showingPlaque ? (
          <div data-player-plaque="true" className="grid gap-3">
            {editingArrangement || arrangeMsg || arrangeErr ? (
              <div
                className="mx-auto flex w-full max-w-240 flex-wrap items-center gap-2 rounded-xl border px-3 py-2 print:hidden"
                style={{
                  borderColor:
                    "color-mix(in oklab, var(--secondary) 55%, var(--stroke))",
                  background:
                    "color-mix(in oklab, var(--bg-base) 80%, transparent)",
                }}
              >
                {editingArrangement ? (
                  <>
                    <div className="mr-auto min-w-0 text-xs leading-snug">
                      <span className="font-black">Arrange awards</span>
                      <span style={{ color: "var(--muted)" }}>
                        {" "}
                        — drag an award onto another slot to swap. Keyboard:
                        Space picks up, arrows move, Space drops.
                      </span>
                      {arrangementDirty ? (
                        <span
                          className="ml-2 font-semibold"
                          style={{ color: "var(--secondary)" }}
                        >
                          Unsaved changes
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraftOrder(recognition.autoOrder)}
                      disabled={
                        arrangeBusy ||
                        sameOrder(draftOrder ?? [], recognition.autoOrder)
                      }
                      className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 92%, transparent)",
                        color: "var(--foreground)",
                      }}
                    >
                      Reset to Automatic
                    </button>
                    <button
                      type="button"
                      onClick={cancelArrangingAction}
                      disabled={arrangeBusy}
                      className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 92%, transparent)",
                        color: "var(--foreground)",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveArrangementAction()}
                      disabled={arrangeBusy || !arrangementDirty}
                      className="rounded-lg border px-3 py-1.5 text-xs font-black disabled:opacity-50"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--secondary) 70%, transparent)",
                        background:
                          "linear-gradient(90deg, var(--primary), var(--secondary))",
                        color: "rgba(0,0,0,0.92)",
                      }}
                    >
                      {arrangeBusy ? "Saving…" : "Save Arrangement"}
                    </button>
                    {arrangeErr ? (
                      <div className="w-full text-xs font-semibold text-red-400">
                        {arrangeErr}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div
                    className="text-xs font-semibold"
                    style={{
                      color: arrangeErr ? "#f87171" : "var(--secondary)",
                    }}
                  >
                    {arrangeErr ?? arrangeMsg}
                  </div>
                )}
              </div>
            ) : null}

            <RecognitionSheetStage
              sheet={sheetProps}
              order={sheetOrder}
              editing={editingArrangement}
              onOrderChange={setDraftOrder}
            />
            <RecognitionPrintRoot sheet={sheetProps} order={sheetOrder} />
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
                  value={String(displayedPlayer.stats.games)}
                />
                <SmallStat
                  label="Plate Appearances"
                  value={String(displayedPlayer.stats.plateAppearances)}
                />
                <SmallStat
                  label="At Bats"
                  value={String(displayedPlayer.stats.atBats)}
                  leader={isLeader("atBats")}
                />
                <SmallStat
                  label="Hits"
                  value={String(displayedPlayer.stats.hits)}
                  leader={isLeader("hits")}
                  behindLeader={reach("hits")}
                />
                <SmallStat
                  label="Longest Hit Streak"
                  value={String(displayedPlayer.stats.longestHitStreak ?? 0)}
                  leader={isLeader("longestHitStreak")}
                  behindLeader={reach("longestHitStreak")}
                />
                <SmallStat
                  label="Doubles"
                  value={String(displayedPlayer.stats.doubles)}
                  leader={isLeader("doubles")}
                  behindLeader={reach("doubles")}
                />
                <SmallStat
                  label="Triples"
                  value={String(displayedPlayer.stats.triples)}
                  leader={isLeader("triples")}
                  behindLeader={reach("triples")}
                />
                <SmallStat
                  label="Home Runs"
                  value={String(displayedPlayer.stats.homeRuns)}
                  leader={isLeader("homeRuns")}
                  behindLeader={reach("homeRuns")}
                />
                <SmallStat
                  label="RBIs: Runs Batted In"
                  value={String(displayedPlayer.stats.rbi)}
                  leader={isLeader("rbi")}
                  behindLeader={reach("rbi")}
                />
                <SmallStat
                  label="Runs"
                  value={String(displayedPlayer.stats.runs)}
                  leader={isLeader("runs")}
                  behindLeader={reach("runs")}
                />
                <SmallStat
                  label="Base on Balls (Walk)"
                  value={String(displayedPlayer.stats.walks)}
                  leader={isLeader("walks")}
                  behindLeader={reach("walks")}
                />
                <SmallStat
                  label="Hit By Pitch"
                  value={String(displayedPlayer.stats.hitByPitch)}
                  leader={isLeader("hitByPitch")}
                />
                <SmallStat
                  label="Stolen Bases"
                  value={String(displayedPlayer.stats.stolenBases)}
                  leader={isLeader("stolenBases")}
                  behindLeader={reach("stolenBases")}
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
                      value={String(displayedPlayer.stats.pitchingStrikeouts)}
                      leader={isLeader("pitchingStrikeouts")}
                      behindLeader={reach("pitchingStrikeouts")}
                    />
                    <SmallStat
                      label="Pitching Saves"
                      value={String(displayedPlayer.stats.pitchingSaves)}
                    />
                    <SmallStat
                      label="Fly Balls Caught"
                      value={String(displayedPlayer.stats.flyBallCatches)}
                    />
                    <SmallStat
                      label="Put Outs (PO)"
                      value={String(displayedPlayer.stats.putOuts)}
                      leader={isLeader("putOuts")}
                      behindLeader={reach("putOuts")}
                    />
                    <SmallStat
                      label="Assists (A)"
                      value={String(displayedPlayer.stats.assists)}
                      leader={isLeader("assists")}
                      behindLeader={reach("assists")}
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
                    Per-game stats and coach recognition for this season
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
                        const streakByGameId = gameLogHitStreaks(gameLog);

                        return gameLog.map((item) => (
                          <GameLogRow
                            key={item.gameId}
                            item={item}
                            hitStreak={streakByGameId.get(item.gameId) ?? 0}
                          />
                        ));
                      })()}
                    </div>
                  )}
                </CardContent>
              </Card>

              <PlayerCareerHistory
                rows={career?.history ?? []}
                currentSeasonId={seasonId}
              />

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
