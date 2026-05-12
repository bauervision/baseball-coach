"use client";

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

function isFinalCoachAward(key: string): boolean {
  return FINAL_COACH_AWARD_KEYS.has(key);
}

function AwardBadge(props: { isRunnerUp: boolean }) {
  const { isRunnerUp } = props;

  return (
    <div
      className="mt-3 inline-flex rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide"
      style={{
        background: isRunnerUp ? "rgba(255,255,255,0.14)" : "#facc15",
        color: isRunnerUp ? "white" : "#121212",
        border: isRunnerUp
          ? "1px solid rgba(255,255,255,0.16)"
          : "1px solid transparent",
      }}
    >
      {isRunnerUp ? "Runner Up" : "Earned"}
    </div>
  );
}

function TrophyImage(props: {
  card: PlaqueAwardCard;
  className: string;
  imageClassName?: string;
}) {
  const {
    card,
    className,
    imageClassName = "h-full w-full object-contain",
  } = props;

  const art = TROPHY_ART[card.trophy.key] ?? "/trophies/trophy.png";

  return (
    <div className={className}>
      <img src={art} alt={card.trophy.title} className={imageClassName} />
    </div>
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
    <section
      className="rounded-2xl border p-3"
      style={{
        borderColor: "rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.045)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div
          className="text-xs font-bold uppercase tracking-[0.18em]"
          style={{ color: "#d4af37" }}
        >
          Final Stats
        </div>

        <div
          className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wide"
          style={{
            background: "rgba(250,204,21,0.14)",
            color: "#facc15",
            border: "1px solid rgba(250,204,21,0.28)",
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
                ? "rgba(250,204,21,0.72)"
                : "rgba(250,204,21,0.16)",
              background: item.leader
                ? "linear-gradient(180deg, rgba(250,204,21,0.24), rgba(255,255,255,0.06))"
                : "linear-gradient(180deg, rgba(250,204,21,0.075), rgba(255,255,255,0.03))",
              boxShadow: item.leader
                ? "0 0 0 1px rgba(250,204,21,0.35) inset, 0 0 18px rgba(250,204,21,0.14)"
                : undefined,
            }}
          >
            <div
              className="text-[8px] font-black uppercase tracking-[0.1em]"
              style={{ color: "rgba(255,255,255,0.62)" }}
            >
              {item.label}
            </div>

            <div
              className="mt-0.5 text-base font-black leading-none"
              style={{ color: item.leader ? "#facc15" : "white" }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BestGamePanel(props: { bestGame: PlayerBestGame }) {
  const { bestGame } = props;

  return (
    <section
      className="rounded-2xl border px-4 py-4"
      style={{
        borderColor: "rgba(250,204,21,0.28)",
        background:
          "linear-gradient(135deg, rgba(250,204,21,0.12), rgba(255,255,255,0.045))",
      }}
    >
      <div
        className="text-xs font-bold uppercase tracking-[0.18em]"
        style={{ color: "#d4af37" }}
      >
        Best Game
      </div>

      <div
        className="mt-2 text-xl font-black leading-tight"
        style={{ color: "white" }}
      >
        {bestGame.date} vs {bestGame.opponent}
      </div>

      <div
        className="mt-1.5 text-base font-semibold"
        style={{ color: "rgba(255,255,255,0.82)" }}
      >
        {bestGame.lineSummary}
      </div>

      <div
        className="mt-1.5 text-xs font-bold uppercase tracking-wide"
        style={{ color: "#facc15" }}
      >
        {bestGame.result} {bestGame.scoreUs}-{bestGame.scoreThem}
      </div>
    </section>
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
      <section
        className="grid min-h-0 place-items-center overflow-hidden rounded-2xl border p-6 text-center"
        style={{
          borderColor: "rgba(255,255,255,0.12)",
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
        }}
      >
        <div>
          <div className="text-3xl font-black" style={{ color: "white" }}>
            Team Contributor
          </div>

          <div
            className="mt-3 max-w-xl text-sm leading-relaxed"
            style={{ color: "rgba(255,255,255,0.74)" }}
          >
            A valued part of the Tigers season — showing up, competing, and
            helping the team grow.
          </div>
        </div>
      </section>
    );
  }

  if (cards.length === 1) {
    const card = cards[0];
    const isRunnerUp = card.kind === "runnerUp";

    return (
      <section
        className="grid min-h-0 grid-cols-[1.1fr_0.9fr] items-center overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: isRunnerUp
            ? "rgba(255,255,255,0.18)"
            : "rgba(250,204,21,0.32)",
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.025))",
        }}
      >
        <TrophyImage
          card={card}
          className="grid h-full min-h-0 place-items-center overflow-hidden rounded-2xl"
          imageClassName="h-full max-h-full w-full max-w-full object-contain"
        />

        <div className="min-w-0 px-6">
          <div className="text-4xl font-black leading-tight text-white">
            {card.trophy.title}
          </div>

          <div
            className="mt-2 text-sm font-semibold"
            style={{ color: "rgba(255,255,255,0.72)" }}
          >
            {isRunnerUp ? "Runner-up performance" : card.trophy.subtitle}
          </div>

          <AwardBadge isRunnerUp={isRunnerUp} />
        </div>
      </section>
    );
  }

  if (cards.length === 2) {
    return (
      <section className="grid min-h-0 grid-cols-2 gap-3 overflow-hidden">
        {cards.map((card) => {
          const isRunnerUp = card.kind === "runnerUp";

          return (
            <div
              key={card.key}
              className="grid min-h-0 grid-rows-[1fr_auto] overflow-hidden rounded-2xl border p-4"
              style={{
                borderColor: isRunnerUp
                  ? "rgba(255,255,255,0.12)"
                  : "rgba(250,204,21,0.22)",
                background:
                  "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
              }}
            >
              <TrophyImage
                card={card}
                className="grid min-h-0 place-items-center overflow-hidden rounded-xl"
                imageClassName="h-full max-h-full w-full max-w-full object-contain"
              />

              <div className="px-2 pt-4 text-center">
                <div className="text-3xl font-black leading-tight text-white">
                  {card.trophy.title}
                </div>

                <div
                  className="mt-1 text-sm font-semibold"
                  style={{ color: "rgba(255,255,255,0.72)" }}
                >
                  {isRunnerUp ? "Runner-up performance" : card.trophy.subtitle}
                </div>

                <AwardBadge isRunnerUp={isRunnerUp} />
              </div>
            </div>
          );
        })}
      </section>
    );
  }

  const isMedium = cards.length >= 5 && cards.length <= 6;
  const isCompact = cards.length >= 7;

  return (
    <section className="grid min-h-0 grid-cols-2 auto-rows-fr gap-3 overflow-hidden">
      {cards.map((card) => {
        const isRunnerUp = card.kind === "runnerUp";

        const cardColumns = isCompact
          ? "grid-cols-[140px_1fr]"
          : isMedium
            ? "grid-cols-[190px_1fr]"
            : "grid-cols-[1fr_1fr]";

        const imageBoxClass = isCompact
          ? "grid h-full min-h-0 place-items-center overflow-hidden rounded-xl"
          : isMedium
            ? "grid h-full min-h-0 place-items-center overflow-hidden rounded-xl"
            : "grid h-full min-h-0 place-items-center overflow-hidden rounded-xl";

        const imageClassName = isCompact
          ? "h-full max-h-36 w-full max-w-full object-contain"
          : isMedium
            ? "h-full max-h-48 w-full max-w-full object-contain"
            : "h-full max-h-full w-full max-w-full object-contain";

        const titleClassName = isCompact
          ? "text-xl font-black leading-tight"
          : "text-2xl font-black leading-tight";

        return (
          <div
            key={card.key}
            className={`relative grid min-h-0 ${cardColumns} items-center overflow-hidden rounded-2xl border p-3`}
            style={{
              borderColor: isRunnerUp
                ? "rgba(255,255,255,0.12)"
                : "rgba(255,255,255,0.14)",
              background: isRunnerUp
                ? "linear-gradient(135deg, rgba(180,180,180,0.08), rgba(255,255,255,0.02))"
                : "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
              opacity: isRunnerUp ? 0.94 : 1,
            }}
          >
            <TrophyImage
              card={card}
              className={imageBoxClass}
              imageClassName={imageClassName}
            />

            <div className="min-w-0 px-5">
              <div className={titleClassName} style={{ color: "white" }}>
                {card.trophy.title}
              </div>

              <div
                className="mt-1 text-xs font-semibold leading-snug"
                style={{ color: "rgba(255,255,255,0.68)" }}
              >
                {isRunnerUp ? "Runner-up performance" : card.trophy.subtitle}
              </div>

              <AwardBadge isRunnerUp={isRunnerUp} />
            </div>
          </div>
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
      className="mx-auto aspect-video h-[calc(100dvh-150px)] max-h-[1000px] min-h-[920px] w-full max-w-[1600px] overflow-hidden rounded-[32px] border print:h-auto print:max-h-none print:rounded-none"
      style={{
        borderColor: "color-mix(in oklab, var(--secondary) 52%, transparent)",
        background:
          "linear-gradient(180deg, #151515 0%, #1d1d1d 32%, #101010 100%)",
        boxShadow:
          "0 0 0 2px color-mix(in oklab, var(--secondary) 18%, transparent) inset, 0 30px 80px rgba(0,0,0,0.45)",
      }}
    >
      <div className="relative h-full overflow-hidden px-6 py-6">
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            background:
              "radial-gradient(circle at top right, #facc15, transparent 32%)",
          }}
        />

        <div className="relative z-10 grid h-full grid-cols-[0.72fr_1.55fr] gap-5">
          <div className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-4">
            <header className="grid grid-cols-[1fr_auto] items-start gap-4">
              <div className="min-w-0">
                <div
                  className="text-xs font-bold uppercase tracking-[0.24em]"
                  style={{ color: "#d4af37" }}
                >
                  End of Season Recognition
                </div>

                <div
                  className="mt-3 text-5xl font-black leading-none"
                  style={{
                    color: "white",
                    textShadow: "0 4px 24px rgba(250,204,21,0.25)",
                  }}
                >
                  {player.name}
                </div>

                <div
                  className="mt-3 text-lg font-semibold"
                  style={{ color: "rgba(255,255,255,0.72)" }}
                >
                  #{player.number} • {teamName} • {seasonLabel}
                </div>
              </div>

              <div
                className="hidden rounded-2xl border px-5 py-4 text-center sm:block"
                style={{
                  borderColor: "rgba(250,204,21,0.28)",
                  background: "rgba(250,204,21,0.08)",
                }}
              >
                <img
                  src="/TigersLogo.png"
                  alt=""
                  className="mx-auto mb-2 h-14 w-14 object-contain"
                  draggable={false}
                />

                <div
                  className="text-[10px] font-bold uppercase tracking-[0.18em]"
                  style={{ color: "rgba(255,255,255,0.7)" }}
                >
                  Honors
                </div>

                <div
                  className="mt-1 text-4xl font-black"
                  style={{ color: "#facc15" }}
                >
                  {awards.length}
                </div>
              </div>
            </header>

            {bestGame ? <BestGamePanel bestGame={bestGame} /> : null}

            {featuredCoachAward ? (
              <section
                className="flex min-h-0 flex-col overflow-hidden rounded-2xl border p-4"
                style={{
                  borderColor: "rgba(250,204,21,0.82)",
                  background:
                    "linear-gradient(135deg, rgba(250,204,21,0.24), rgba(255,255,255,0.06))",
                  boxShadow:
                    "0 0 0 1px rgba(250,204,21,0.4) inset, 0 0 34px rgba(250,204,21,0.18)",
                }}
              >
                <div
                  className="text-xs font-black uppercase tracking-[0.18em]"
                  style={{ color: "#facc15" }}
                >
                  Final Coach Award
                </div>

                <div className="mt-3 grid min-h-0 flex-1">
                  <img
                    src={
                      TROPHY_ART[featuredCoachAward.trophy.key] ??
                      "/trophies/trophy.png"
                    }
                    alt={featuredCoachAward.trophy.title}
                    className="h-full min-h-0 w-full rounded-2xl border object-cover"
                    style={{ borderColor: "rgba(250,204,21,0.55)" }}
                  />
                </div>
              </section>
            ) : (
              <section
                className="relative flex min-h-0 flex-col overflow-hidden rounded-2xl border px-4 py-4"
                style={{
                  borderColor: "rgba(255,255,255,0.14)",
                  background:
                    "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.025))",
                }}
              >
                <div
                  className="text-xs font-bold uppercase tracking-[0.18em]"
                  style={{ color: "#d4af37" }}
                >
                  Coach Recognition
                </div>

                <div className="relative flex flex-1 items-center justify-center overflow-hidden">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.32]"
                  >
                    <div className="tigersLogoGridStatic h-[72%] w-[72%] max-w-80" />
                  </div>

                  <div className="relative z-10 max-w-md text-center">
                    <div
                      className="text-3xl font-black leading-tight"
                      style={{
                        color: "white",
                        textShadow: "0 4px 24px rgba(0,0,0,0.35)",
                      }}
                    >
                      Tigers Baseball
                    </div>

                    <div
                      className="mt-2 text-sm font-semibold uppercase tracking-[0.22em]"
                      style={{ color: "#facc15" }}
                    >
                      {seasonLabel}
                    </div>

                    <div
                      className="mt-5 text-sm leading-relaxed"
                      style={{ color: "rgba(255,255,255,0.82)" }}
                    >
                      Thank you for the energy, effort, teamwork, and heart you
                      brought to the Tigers this season. Every practice, every
                      game, and every moment helped shape this team.
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="grid min-h-0 grid-rows-[1fr_auto] gap-4 overflow-hidden">
            <AwardsGrid
              regularAwards={regularAwards}
              runnerUpAwards={runnerUpAwards}
            />

            <FinalStatGrid player={player} leaders={leaders} />
          </div>
        </div>
      </div>
    </div>
  );
}
