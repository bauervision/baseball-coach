"use client";

import type { ReactNode } from "react";

import type { Player, LeadersMap, StatKey } from "@/lib/roster";
import {
  battingAverage,
  fmt3,
  onBasePercentage,
  ops,
  slugging,
} from "@/lib/roster";
import type { TrophyAward, RunnerUpAward, TrophyDef } from "@/lib/trophies";
import { TROPHY_ART } from "@/lib/trophyArtwork";
import type { PlayerBestGame } from "@/components/player/playerBestGame";

type StatItem = {
  label: string;
  value: string;
  leader: boolean;
};

type PlaqueAwardCard = {
  key: string;
  trophy: TrophyDef;
  kind: "earned" | "runnerUp";
};

const FINAL_COACH_AWARD_KEYS = new Set([
  "mvp",
  "dominator",
  "honorable_mention",
  "best_all_around",
]);

const TIGERS_ORANGE_FILTER =
  "brightness(0) saturate(100%) invert(49%) sepia(98%) saturate(1901%) hue-rotate(2deg) brightness(101%) contrast(101%)";

function isFinalCoachAward(key: string): boolean {
  return FINAL_COACH_AWARD_KEYS.has(key);
}

function AwardBadge(props: { isRunnerUp: boolean }) {
  const { isRunnerUp } = props;

  return (
    <div
      className="mt-3 inline-flex rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-wide"
      style={{
        background: isRunnerUp
          ? "color-mix(in oklab, var(--muted) 16%, transparent)"
          : "var(--secondary)",
        color: isRunnerUp ? "var(--foreground)" : "rgba(0,0,0,0.92)",
        borderColor: isRunnerUp
          ? "color-mix(in oklab, var(--stroke) 90%, transparent)"
          : "transparent",
      }}
    >
      {isRunnerUp ? "Runner Up" : "Earned"}
    </div>
  );
}

function TrophyImage(props: {
  card: PlaqueAwardCard;
  className?: string;
  imageClassName?: string;
}) {
  const {
    card,
    className = "",
    imageClassName = "h-full w-full object-contain",
  } = props;

  const art = TROPHY_ART[card.trophy.key] ?? "/trophies/trophy.png";

  return (
    <div
      className={`grid min-h-0 place-items-center overflow-hidden ${className}`}
    >
      <img src={art} alt={card.trophy.title} className={imageClassName} />
    </div>
  );
}

function Panel(props: {
  children: ReactNode;
  className?: string;
  accent?: boolean;
}) {
  const { children, className = "", accent = false } = props;

  return (
    <section
      className={`rounded-2xl border ${className}`}
      style={{
        borderColor: accent
          ? "color-mix(in oklab, var(--secondary) 56%, var(--stroke))"
          : "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background: accent
          ? "linear-gradient(135deg, color-mix(in oklab, var(--secondary) 13%, var(--card)), color-mix(in oklab, var(--card) 94%, transparent))"
          : "color-mix(in oklab, var(--card) 94%, transparent)",
      }}
    >
      {children}
    </section>
  );
}

function FinalStatGrid(props: { player: Player; leaders: LeadersMap }) {
  const { player, leaders } = props;
  const s = player.stats;

  function isLeader(key: StatKey): boolean {
    return leaders[key]?.includes(player.id) ?? false;
  }

  const stats: StatItem[] = [
    {
      label: "AVG",
      value: fmt3(battingAverage(player)),
      leader: isLeader("avg"),
    },
    {
      label: "OBP",
      value: fmt3(onBasePercentage(player)),
      leader: isLeader("obp"),
    },
    { label: "SLG", value: fmt3(slugging(player)), leader: isLeader("slg") },
    { label: "OPS", value: fmt3(ops(player)), leader: isLeader("ops") },
    { label: "G", value: String(s.games), leader: false },
    { label: "PA", value: String(s.plateAppearances), leader: false },
    { label: "AB", value: String(s.atBats), leader: isLeader("atBats") },
    { label: "H", value: String(s.hits), leader: isLeader("hits") },
    { label: "R", value: String(s.runs), leader: isLeader("runs") },
    { label: "RBI", value: String(s.rbi), leader: isLeader("rbi") },
    { label: "BB", value: String(s.walks), leader: isLeader("walks") },
    {
      label: "HBP",
      value: String(s.hitByPitch),
      leader: isLeader("hitByPitch"),
    },
    { label: "2B", value: String(s.doubles), leader: isLeader("doubles") },
    { label: "3B", value: String(s.triples), leader: isLeader("triples") },
    { label: "HR", value: String(s.homeRuns), leader: isLeader("homeRuns") },
    {
      label: "SB",
      value: String(s.stolenBases),
      leader: isLeader("stolenBases"),
    },
    {
      label: "HS",
      value: String(s.longestHitStreak ?? 0),
      leader: isLeader("longestHitStreak"),
    },
    { label: "PO", value: String(s.putOuts), leader: isLeader("putOuts") },
    { label: "A", value: String(s.assists), leader: isLeader("assists") },
    {
      label: "P-K",
      value: String(s.pitchingStrikeouts),
      leader: isLeader("pitchingStrikeouts"),
    },
    { label: "SV", value: String(s.pitchingSaves), leader: false },
    { label: "FB", value: String(s.flyBallCatches), leader: false },
  ];

  return (
    <Panel className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div
          className="text-xs font-black uppercase tracking-[0.22em]"
          style={{ color: "var(--secondary)" }}
        >
          Final Stats
        </div>

        <div
          className="rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wide"
          style={{
            background:
              "color-mix(in oklab, var(--secondary) 12%, transparent)",
            color: "var(--secondary)",
            borderColor:
              "color-mix(in oklab, var(--secondary) 35%, transparent)",
          }}
        >
          Gold = Leader
        </div>
      </div>

      <div className="mt-3 grid grid-cols-11 gap-1.5">
        {stats.map((item) => (
          <div
            key={item.label}
            className="relative overflow-hidden rounded-xl border px-2 py-1.5 text-center"
            style={{
              borderColor: item.leader
                ? "color-mix(in oklab, var(--secondary) 72%, var(--stroke))"
                : "color-mix(in oklab, var(--stroke) 88%, transparent)",
              background: item.leader
                ? "linear-gradient(180deg, color-mix(in oklab, var(--secondary) 18%, var(--card)), color-mix(in oklab, var(--card) 94%, transparent))"
                : "color-mix(in oklab, var(--bg-base) 30%, var(--card))",
            }}
          >
            <div
              className="text-[8px] font-black uppercase tracking-[0.1em]"
              style={{ color: "var(--muted)" }}
            >
              {item.label}
            </div>

            <div
              className="mt-0.5 text-base font-black leading-none"
              style={{
                color: item.leader ? "var(--secondary)" : "var(--foreground)",
              }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function BestGamePanel(props: { bestGame: PlayerBestGame }) {
  const { bestGame } = props;

  return (
    <Panel className="px-4 py-4" accent>
      <div
        className="text-xs font-black uppercase tracking-[0.2em]"
        style={{ color: "var(--secondary)" }}
      >
        Best Game
      </div>

      <div className="mt-2 text-xl font-black leading-tight">
        {bestGame.date} vs {bestGame.opponent}
      </div>

      <div
        className="mt-1.5 text-base font-semibold"
        style={{ color: "var(--muted)" }}
      >
        {bestGame.lineSummary}
      </div>

      <div
        className="mt-1.5 text-xs font-black uppercase tracking-wide"
        style={{ color: "var(--secondary)" }}
      >
        {bestGame.result} {bestGame.scoreUs}-{bestGame.scoreThem}
      </div>
    </Panel>
  );
}

function AwardsGrid(props: {
  regularAwards: TrophyAward[];
  runnerUpAwards: RunnerUpAward[];
}) {
  const { regularAwards, runnerUpAwards } = props;

  const runnerUpLimit =
    regularAwards.length >= 4 ? 0 : regularAwards.length >= 2 ? 2 : 4;

  const visibleRunnerUps = runnerUpAwards.slice(0, runnerUpLimit);

  const cards: PlaqueAwardCard[] = [
    ...regularAwards.map((award) => ({
      key: `earned-${award.trophy.key}`,
      trophy: award.trophy,
      kind: "earned" as const,
    })),
    ...visibleRunnerUps.map((award) => ({
      key: `runnerup-${award.trophy.key}`,
      trophy: award.trophy,
      kind: "runnerUp" as const,
    })),
  ];

  if (cards.length === 0) {
    return (
      <Panel className="grid min-h-0 place-items-center overflow-hidden p-6 text-center">
        <div>
          <div className="text-4xl font-black">Team Contributor</div>

          <div
            className="mt-3 max-w-xl text-sm leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            A valued part of the Tigers season — showing up, competing, and
            helping the team grow.
          </div>
        </div>
      </Panel>
    );
  }

  if (cards.length <= 2) {
    return (
      <section className="grid min-h-0 grid-cols-2 gap-3 overflow-hidden">
        {cards.map((card) => {
          const isRunnerUp = card.kind === "runnerUp";

          return (
            <Panel
              key={card.key}
              className="grid min-h-0 grid-cols-[1fr_0.78fr] items-center overflow-hidden p-4"
              accent={!isRunnerUp}
            >
              <TrophyImage
                card={card}
                className="h-full rounded-xl"
                imageClassName="h-full max-h-72 w-full object-contain"
              />

              <div className="min-w-0 px-4">
                <div className="text-3xl font-black leading-tight">
                  {card.trophy.title}
                </div>

                <div
                  className="mt-2 text-sm font-semibold"
                  style={{ color: "var(--muted)" }}
                >
                  {isRunnerUp ? "Runner-up performance" : card.trophy.subtitle}
                </div>

                <AwardBadge isRunnerUp={isRunnerUp} />
              </div>
            </Panel>
          );
        })}
      </section>
    );
  }

  return (
    <section className="grid min-h-0 grid-cols-2 auto-rows-fr gap-3 overflow-hidden">
      {cards.map((card) => {
        const isRunnerUp = card.kind === "runnerUp";

        return (
          <Panel
            key={card.key}
            className="grid min-h-0 grid-cols-[1.05fr_0.95fr] items-center overflow-hidden p-4"
            accent={!isRunnerUp}
          >
            <TrophyImage
              card={card}
              className="h-full rounded-xl"
              imageClassName="h-full max-h-64 w-full object-contain"
            />

            <div className="min-w-0 px-4">
              <div className="text-3xl font-black leading-tight">
                {card.trophy.title}
              </div>

              <div
                className="mt-2 text-sm font-semibold leading-snug"
                style={{ color: "var(--muted)" }}
              >
                {isRunnerUp ? "Runner-up performance" : card.trophy.subtitle}
              </div>

              <AwardBadge isRunnerUp={isRunnerUp} />
            </div>
          </Panel>
        );
      })}
    </section>
  );
}

export function PlayerSeasonPlaque(props: {
  player: Player;
  teamName: string;
  seasonLabel: string;
  awards: TrophyAward[];
  bestGame: PlayerBestGame | null;
  leaders: LeadersMap;
  runnerUpAwards: RunnerUpAward[];
}) {
  const {
    player,
    teamName,
    seasonLabel,
    awards,
    bestGame,
    leaders,
    runnerUpAwards,
  } = props;

  const featuredCoachAward =
    awards.find((award) => isFinalCoachAward(award.trophy.key)) ?? null;

  const regularAwards = awards.filter(
    (award) => !isFinalCoachAward(award.trophy.key),
  );

  return (
    <div
      id="player-season-plaque-print"
      className="player-season-plaque mx-auto aspect-video h-[calc(100dvh-150px)] max-h-[1000px] min-h-[920px] w-full max-w-[1600px] overflow-hidden rounded-[32px] border print:h-auto print:max-h-none print:rounded-none"
      style={{
        color: "var(--foreground)",
        borderColor: "color-mix(in oklab, var(--secondary) 52%, var(--stroke))",
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--card) 96%, var(--bg-base)) 0%, var(--bg-base) 100%)",
      }}
    >
      <div className="relative h-full overflow-hidden px-6 py-6">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            background:
              "radial-gradient(circle at top right, var(--secondary), transparent 34%)",
          }}
        />

        <div className="relative z-10 grid h-full grid-rows-[1fr_auto] gap-3">
          <div className="grid min-h-0 grid-cols-[0.74fr_1.62fr] gap-4">
            <div className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-4">
              <header className="grid grid-cols-[1fr_auto] items-start gap-4">
                <div className="min-w-0">
                  <div
                    className="text-xs font-black uppercase tracking-[0.26em]"
                    style={{ color: "var(--secondary)" }}
                  >
                    End of Season Recognition
                  </div>

                  <div
                    className="mt-3 text-5xl font-black leading-none"
                    style={{ color: "var(--foreground)" }}
                  >
                    {player.name}
                  </div>

                  <div
                    className="mt-3 text-lg font-bold"
                    style={{ color: "var(--muted)" }}
                  >
                    #{player.number} • {teamName} • {seasonLabel}
                  </div>
                </div>

                <div
                  className="hidden rounded-2xl border px-5 py-4 text-center sm:block"
                  style={{
                    borderColor:
                      "color-mix(in oklab, var(--secondary) 38%, var(--stroke))",
                    background:
                      "color-mix(in oklab, var(--secondary) 9%, var(--card))",
                  }}
                >
                  <img
                    src="/TigersLogo.png"
                    alt=""
                    className="mx-auto mb-2 h-14 w-14 object-contain"
                    draggable={false}
                    style={{ filter: TIGERS_ORANGE_FILTER }}
                  />

                  <div
                    className="text-[10px] font-black uppercase tracking-[0.18em]"
                    style={{ color: "var(--muted)" }}
                  >
                    Honors
                  </div>

                  <div
                    className="mt-1 text-4xl font-black"
                    style={{ color: "var(--secondary)" }}
                  >
                    {awards.length}
                  </div>
                </div>
              </header>

              {bestGame ? <BestGamePanel bestGame={bestGame} /> : null}

              {featuredCoachAward ? (
                <Panel
                  className="flex min-h-0 flex-col overflow-hidden p-4"
                  accent
                >
                  <div
                    className="text-xs font-black uppercase tracking-[0.2em]"
                    style={{ color: "var(--secondary)" }}
                  >
                    Final Coach Award
                  </div>

                  <div className="mt-3 grid min-h-0 flex-1 grid-rows-[1fr_auto] gap-2 overflow-hidden">
                    <div className="grid min-h-0 place-items-center overflow-hidden rounded-2xl">
                      <img
                        src={
                          TROPHY_ART[featuredCoachAward.trophy.key] ??
                          "/trophies/trophy.png"
                        }
                        alt={featuredCoachAward.trophy.title}
                        className="h-full max-h-full w-full max-w-full rounded-2xl border object-contain"
                        style={{
                          borderColor:
                            "color-mix(in oklab, var(--secondary) 58%, var(--stroke))",
                        }}
                      />
                    </div>

                    <div className="grid shrink-0 place-items-center text-center">
                      <img
                        src="/TigersLogo.png"
                        alt=""
                        className="h-9 w-9 object-contain"
                        draggable={false}
                        style={{ filter: TIGERS_ORANGE_FILTER }}
                      />

                      <div className="mt-0.5 text-lg font-black leading-tight">
                        Tigers Baseball
                      </div>

                      <div
                        className="mt-0.5 text-[10px] font-black uppercase tracking-[0.24em]"
                        style={{ color: "var(--secondary)" }}
                      >
                        {seasonLabel}
                      </div>

                      <div
                        className="mt-1 max-w-xs text-[10px] font-semibold leading-snug"
                        style={{ color: "var(--muted)" }}
                      >
                        Thank you for the energy, effort, teamwork, and heart
                        you brought to the Tigers this season.
                      </div>
                    </div>
                  </div>
                </Panel>
              ) : (
                <Panel className="relative flex min-h-0 flex-col overflow-hidden px-4 py-4">
                  <div
                    className="text-xs font-black uppercase tracking-[0.2em]"
                    style={{ color: "var(--secondary)" }}
                  >
                    Coach Recognition
                  </div>

                  <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden">
                    <img
                      src="/TigersLogo.png"
                      alt=""
                      className="h-36 w-36 object-contain"
                      draggable={false}
                      style={{ filter: TIGERS_ORANGE_FILTER }}
                    />

                    <div className="relative z-10 max-w-md text-center">
                      <div className="text-3xl font-black leading-tight">
                        Tigers Baseball
                      </div>

                      <div
                        className="mt-2 text-sm font-black uppercase tracking-[0.24em]"
                        style={{ color: "var(--secondary)" }}
                      >
                        {seasonLabel}
                      </div>

                      <div
                        className="mt-5 text-sm leading-relaxed"
                        style={{ color: "var(--muted)" }}
                      >
                        Thank you for the energy, effort, teamwork, and heart
                        you brought to the Tigers this season. Every practice,
                        every game, and every moment helped shape this team.
                      </div>
                    </div>
                  </div>
                </Panel>
              )}
            </div>

            <div className="grid min-h-0 overflow-hidden">
              <AwardsGrid
                regularAwards={regularAwards}
                runnerUpAwards={runnerUpAwards}
              />
            </div>
          </div>

          <FinalStatGrid player={player} leaders={leaders} />
        </div>
      </div>
    </div>
  );
}
