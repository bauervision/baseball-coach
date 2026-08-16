"use client";

import Image from "next/image";
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

function trophyArtFor(card: PlaqueAwardCard): string {
  return TROPHY_ART[card.trophy.key] ?? "/trophies/trophy.png";
}

function trophyArtForAward(award: TrophyAward): string {
  return TROPHY_ART[award.trophy.key] ?? "/trophies/trophy.png";
}

function Panel(props: {
  children: ReactNode;
  className?: string;
  dark?: boolean;
}) {
  const { children, className = "", dark = false } = props;

  return (
    <section
      className={`overflow-hidden rounded-[22px] border ${className}`}
      style={{
        borderColor: dark
          ? "color-mix(in oklab, var(--secondary) 62%, #1b1b1b)"
          : "color-mix(in oklab, var(--secondary) 36%, var(--stroke))",
        background: dark
          ? "linear-gradient(135deg, #050505 0%, #111 52%, #050505 100%)"
          : "linear-gradient(135deg, color-mix(in oklab, var(--card) 98%, #fff), color-mix(in oklab, var(--secondary) 5%, var(--card)))",
        boxShadow: dark
          ? "0 12px 24px rgba(0,0,0,0.24), inset 0 0 36px rgba(255,128,0,0.08)"
          : "0 10px 22px rgba(0,0,0,0.055)",
      }}
    >
      {children}
    </section>
  );
}

function EarnedBadge(props: { isRunnerUp: boolean }) {
  const { isRunnerUp } = props;

  return (
    <div
      className="mt-3 inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wide"
      style={{
        background: isRunnerUp ? "#d8d8d8" : "var(--secondary)",
        color: "rgba(0,0,0,0.92)",
      }}
    >
      {isRunnerUp ? "Runner Up" : "Earned"}
    </div>
  );
}

function BestGamePanel(props: { bestGame: PlayerBestGame }) {
  const { bestGame } = props;

  return (
    <Panel className="px-5 py-4">
      <div
        className="text-xs font-black uppercase tracking-[0.26em]"
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

function CoachRecognitionPanel(props: {
  seasonLabel: string;
  featuredCoachAward: TrophyAward | null;
}) {
  const { seasonLabel, featuredCoachAward } = props;

  return (
    <Panel className="relative flex min-h-0 flex-col overflow-hidden px-4 py-4">
      <Image
        src="/baseballBG.png"
        alt=""
        fill
        sizes="100vw"
        className="absolute inset-0 h-full w-full object-cover opacity-[0.22]"
      />

      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.58), rgba(255,255,255,0.82))",
        }}
      />

      <div className="relative z-10 flex items-center gap-3">
        <div
          className="text-xs font-black uppercase tracking-[0.26em]"
          style={{ color: "var(--secondary)" }}
        >
          Coach Recognition
        </div>

        <div
          className="h-px flex-1"
          style={{
            background:
              "linear-gradient(90deg, color-mix(in oklab, var(--secondary) 75%, transparent), transparent)",
          }}
        />
      </div>

      <div className="relative z-10 grid min-h-0 flex-1 grid-rows-[1fr_auto] gap-4 overflow-hidden pt-4 text-center">
        <div className="relative min-h-0 overflow-hidden rounded-xl">
          <Image
            src={
              featuredCoachAward
                ? trophyArtForAward(featuredCoachAward)
                : "/TigersLogo.png"
            }
            alt={featuredCoachAward?.trophy.title ?? "Tigers Baseball"}
            fill
            sizes="(min-width: 640px) 360px, 90vw"
            className="h-full w-full object-contain object-top"
            style={
              featuredCoachAward ? undefined : { filter: TIGERS_ORANGE_FILTER }
            }
          />
        </div>

        <div className="shrink-0 pb-2">
          <div className="text-3xl font-black leading-none">
            Tigers Baseball
          </div>

          <div
            className="mt-2 text-xs font-black uppercase tracking-[0.3em]"
            style={{ color: "var(--secondary)" }}
          >
            {seasonLabel}
          </div>

          <div
            className="mx-auto mt-4 max-w-sm text-[11px] font-semibold leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            Thank you for the energy, effort, teamwork, and heart you brought to
            the Tigers this season. Every practice, every game, and every moment
            helped shape this team.
          </div>

          <div
            className="mt-3 text-xs font-semibold italic"
            style={{ color: "var(--muted)" }}
          >
            — Coaching Staff
          </div>
        </div>
      </div>
    </Panel>
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
    { label: "R", value: String(s.runs), leader: isLeader("runs") },
    { label: "H", value: String(s.hits), leader: isLeader("hits") },
    { label: "RBI", value: String(s.rbi), leader: isLeader("rbi") },
    { label: "BB", value: String(s.walks), leader: isLeader("walks") },
    { label: "2B", value: String(s.doubles), leader: isLeader("doubles") },
    { label: "3B", value: String(s.triples), leader: isLeader("triples") },
    { label: "HR", value: String(s.homeRuns), leader: isLeader("homeRuns") },
    {
      label: "SB",
      value: String(s.stolenBases),
      leader: isLeader("stolenBases"),
    },
    {
      label: "SO",
      value: String(s.pitchingStrikeouts),
      leader: isLeader("pitchingStrikeouts"),
    },
    {
      label: "HS",
      value: String(s.longestHitStreak ?? 0),
      leader: isLeader("longestHitStreak"),
    },
    { label: "PO", value: String(s.putOuts), leader: isLeader("putOuts") },
    { label: "A", value: String(s.assists), leader: isLeader("assists") },
    { label: "E", value: "0", leader: false },
    { label: "FB", value: String(s.flyBallCatches), leader: false },
    { label: "SV", value: String(s.pitchingSaves), leader: false },
  ];

  return (
    <section className="overflow-hidden rounded-[22px] bg-[#050505] px-7 py-6 text-white shadow-2xl">
      <div className="grid grid-cols-[165px_1fr] items-center gap-6">
        <div
          className="text-lg font-black uppercase leading-tight tracking-[0.24em]"
          style={{ color: "var(--secondary)" }}
        >
          Final
          <br />
          Stats
        </div>

        <div className="grid grid-cols-11 gap-x-0 gap-y-4">
          {stats.map((item) => (
            <div
              key={item.label}
              className="border-l px-4 text-center first:border-l-0"
              style={{ borderColor: "rgba(255,255,255,0.18)" }}
            >
              <div className="text-[13px] font-black uppercase leading-none tracking-[0.1em] text-white/65">
                {item.label}
              </div>

              <div
                className="mt-1.5 text-2xl font-black leading-none"
                style={{
                  color: item.leader
                    ? "var(--secondary)"
                    : "rgba(255,255,255,0.96)",
                }}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroAwardCard(props: { card: PlaqueAwardCard }) {
  const { card } = props;
  const isRunnerUp = card.kind === "runnerUp";

  return (
    <Panel
      dark
      className="grid min-h-0 grid-cols-[0.92fr_1fr] items-center p-5"
    >
      <div className="relative h-full min-h-0 overflow-hidden rounded-2xl">
        <Image
          src={trophyArtFor(card)}
          alt={card.trophy.title}
          fill
          sizes="(min-width: 640px) 320px, 45vw"
          className="h-full w-full object-cover"
        />
      </div>

      <div className="px-8 text-center">
        <div
          className="text-6xl font-black uppercase leading-none tracking-tight"
          style={{
            color: "#f7c96d",
            textShadow: "0 2px 0 rgba(0,0,0,0.35)",
          }}
        >
          {card.trophy.title}
        </div>

        <div
          className="mx-auto mt-7 h-px w-56"
          style={{
            background:
              "linear-gradient(90deg, transparent, var(--secondary), transparent)",
          }}
        />

        <div className="mt-7 text-lg font-black text-white/90">
          {isRunnerUp ? "Runner-up performance" : card.trophy.subtitle}
        </div>

        <EarnedBadge isRunnerUp={isRunnerUp} />
      </div>
    </Panel>
  );
}

function SmallAwardCard(props: { card: PlaqueAwardCard }) {
  const { card } = props;
  const isRunnerUp = card.kind === "runnerUp";

  return (
    <Panel
      dark
      className="grid min-h-0 grid-cols-[0.92fr_1fr] items-center p-4"
    >
      <div className="relative h-full min-h-0 overflow-hidden rounded-xl">
        <Image
          src={trophyArtFor(card)}
          alt={card.trophy.title}
          fill
          sizes="(min-width: 640px) 260px, 45vw"
          className="h-full w-full object-cover"
        />
      </div>

      <div className="min-w-0 px-5">
        <div className="text-3xl font-black uppercase leading-tight text-white">
          {card.trophy.title}
        </div>

        <div className="mt-2 text-sm font-semibold leading-snug text-white/72">
          {isRunnerUp ? "Runner-up performance" : card.trophy.subtitle}
        </div>

        <EarnedBadge isRunnerUp={isRunnerUp} />
      </div>
    </Panel>
  );
}

function HonorsSummaryCard(props: {
  awardCount: number;
  extraAwards: PlaqueAwardCard[];
}) {
  const { awardCount, extraAwards } = props;

  const visibleExtras = extraAwards.slice(0, awardCount >= 8 ? 3 : 2);

  if (awardCount >= 8) {
    return (
      <Panel dark className="grid min-h-0 grid-rows-[1fr_auto] gap-3 p-5">
        <div className="grid min-h-0 grid-cols-3 gap-3">
          {visibleExtras.map((award) => (
            <div
              key={award.key}
              className="grid min-w-0 grid-rows-[1fr_auto] text-center"
            >
              <div className="relative min-h-0 overflow-hidden rounded-xl ring-1 ring-orange-400/45">
                <Image
                  src={trophyArtFor(award)}
                  alt={award.trophy.title}
                  fill
                  sizes="(min-width: 1024px) 160px, 30vw"
                  className="object-cover"
                />
              </div>

              <div className="mt-1.5 truncate text-[10px] font-black uppercase tracking-[0.08em] text-white">
                {award.trophy.title}
              </div>
            </div>
          ))}
        </div>

        <div className="text-center">
          <div
            className="text-5xl font-black leading-none"
            style={{ color: "var(--secondary)" }}
          >
            {awardCount}
          </div>

          <div className="mt-2 text-xl font-black uppercase leading-tight tracking-[0.18em] text-white">
            Honors Earned
          </div>

          <div
            className="mx-auto mt-3 h-1 w-20 rounded-full"
            style={{ background: "var(--secondary)" }}
          />
        </div>
      </Panel>
    );
  }

  if (awardCount >= 7) {
    return (
      <Panel
        dark
        className="grid min-h-0 grid-cols-[1fr_auto_1fr] items-center gap-5 p-5"
      >
        {visibleExtras[0] ? (
          <div className="grid min-h-0 min-w-0 grid-rows-[1fr_auto] text-center">
            <div className="relative min-h-0 overflow-hidden rounded-xl ring-1 ring-orange-400/45">
              <Image
                src={trophyArtFor(visibleExtras[0])}
                alt={visibleExtras[0].trophy.title}
                fill
                sizes="(min-width: 640px) 160px, 30vw"
                className="object-cover"
              />
            </div>

            <div className="mt-1.5 truncate text-[10px] font-black uppercase tracking-[0.08em] text-white">
              {visibleExtras[0].trophy.title}
            </div>
          </div>
        ) : (
          <div />
        )}

        <div className="text-center">
          <div
            className="text-6xl font-black leading-none"
            style={{ color: "var(--secondary)" }}
          >
            {awardCount}
          </div>

          <div className="mt-3 text-2xl font-black uppercase leading-tight tracking-[0.18em] text-white">
            Honors
            <br />
            Earned
          </div>

          <div
            className="mx-auto mt-5 h-1 w-20 rounded-full"
            style={{ background: "var(--secondary)" }}
          />
        </div>

        {visibleExtras[1] ? (
          <div className="grid min-h-0 min-w-0 grid-rows-[1fr_auto] text-center">
            <div className="relative min-h-0 overflow-hidden rounded-xl ring-1 ring-orange-400/45">
              <Image
                src={trophyArtFor(visibleExtras[1])}
                alt={visibleExtras[1].trophy.title}
                fill
                sizes="(min-width: 640px) 160px, 30vw"
                className="object-cover"
              />
            </div>

            <div className="mt-1.5 truncate text-[10px] font-black uppercase tracking-[0.08em] text-white">
              {visibleExtras[1].trophy.title}
            </div>
          </div>
        ) : (
          <div />
        )}
      </Panel>
    );
  }

  return (
    <Panel dark className="relative grid place-items-center p-6">
      <div className="relative z-10 text-center">
        <div
          className="text-6xl font-black leading-none"
          style={{ color: "var(--secondary)" }}
        >
          {awardCount}
        </div>

        <div className="mt-3 text-2xl font-black uppercase leading-tight tracking-[0.18em] text-white">
          Honors
          <br />
          Earned
        </div>

        <div
          className="mx-auto mt-5 h-1 w-20 rounded-full"
          style={{ background: "var(--secondary)" }}
        />
      </div>
    </Panel>
  );
}

function TeamContributorCard() {
  return (
    <Panel dark className="grid min-h-0 place-items-center p-8 text-center">
      <div>
        <div className="text-5xl font-black uppercase text-white">
          Team Contributor
        </div>

        <div className="mx-auto mt-4 max-w-xl text-base font-semibold leading-relaxed text-white/70">
          A valued part of the Tigers season — showing up, competing, and
          helping the team grow.
        </div>
      </div>
    </Panel>
  );
}

function AwardsGrid(props: {
  regularAwards: TrophyAward[];
  runnerUpAwards: RunnerUpAward[];
  awardCount: number;
}) {
  const { regularAwards, runnerUpAwards, awardCount } = props;

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
    return <TeamContributorCard />;
  }

  const hero = cards[0];
  const supporting = cards.slice(1, 4);
  const extraAwards = cards.slice(4);

  if (cards.length === 1) {
    return (
      <section className="grid min-h-0 grid-rows-[1.45fr_1fr] gap-4 overflow-hidden">
        <HeroAwardCard card={hero} />
        <HonorsSummaryCard awardCount={awardCount} extraAwards={extraAwards} />
      </section>
    );
  }

  if (cards.length === 2) {
    return (
      <section className="grid min-h-0 grid-rows-[1.25fr_1fr] gap-4 overflow-hidden">
        <HeroAwardCard card={hero} />

        <div className="grid min-h-0 grid-cols-2 gap-4">
          <SmallAwardCard card={supporting[0]} />
          <HonorsSummaryCard
            awardCount={awardCount}
            extraAwards={extraAwards}
          />
        </div>
      </section>
    );
  }

  if (cards.length === 3) {
    return (
      <section className="grid min-h-0 grid-rows-[1.18fr_1fr_0.82fr] gap-4 overflow-hidden">
        <HeroAwardCard card={hero} />

        <div className="grid min-h-0 grid-cols-2 gap-4">
          <SmallAwardCard card={supporting[0]} />
          <SmallAwardCard card={supporting[1]} />
        </div>

        <HonorsSummaryCard awardCount={awardCount} extraAwards={extraAwards} />
      </section>
    );
  }

  return (
    <section className="grid min-h-0 grid-rows-[1.18fr_1fr_1fr] gap-4 overflow-hidden">
      <HeroAwardCard card={hero} />

      <div className="grid min-h-0 grid-cols-2 gap-4">
        <SmallAwardCard card={supporting[0]} />
        <SmallAwardCard card={supporting[1]} />
      </div>

      <div className="grid min-h-0 grid-cols-2 gap-4">
        <SmallAwardCard card={supporting[2]} />
        <HonorsSummaryCard awardCount={awardCount} extraAwards={extraAwards} />
      </div>
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
      className="player-season-plaque mx-auto aspect-video h-[calc(100dvh-150px)] max-h-[1000px] min-h-[920px] w-full max-w-[1600px] overflow-hidden rounded-[28px] border print:h-auto print:max-h-none print:scale-[0.96] print:rounded-none"
      style={{
        color: "var(--foreground)",
        borderColor: "color-mix(in oklab, var(--secondary) 45%, var(--stroke))",
        background:
          "linear-gradient(135deg, #faf6ef 0%, #fffdf9 42%, #f5efe6 100%)",
      }}
    >
      <div className="relative h-full overflow-hidden px-8 py-7 print:p-10">
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 52%, var(--secondary), transparent 22%), radial-gradient(circle at 84% 8%, var(--secondary), transparent 20%)",
          }}
        />

        <div className="relative z-10 grid h-full grid-rows-[1fr_auto] gap-5">
          <div className="grid min-h-0 grid-cols-[0.68fr_1.86fr] gap-6">
            <aside className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-5">
              <header>
                <div
                  className="text-xs font-black uppercase tracking-[0.32em]"
                  style={{ color: "var(--secondary)" }}
                >
                  End of Season Recognition
                </div>

                <div className="mt-4 text-7xl font-black uppercase leading-[0.9] tracking-tight">
                  {player.name}
                </div>

                <div
                  className="mt-4 text-xl font-black uppercase tracking-[0.08em]"
                  style={{ color: "var(--muted)" }}
                >
                  #{player.number} • {teamName} • {seasonLabel}
                </div>
              </header>

              {bestGame ? <BestGamePanel bestGame={bestGame} /> : null}

              <CoachRecognitionPanel
                seasonLabel={seasonLabel}
                featuredCoachAward={featuredCoachAward}
              />
            </aside>

            <main className="grid min-h-0 overflow-hidden">
              <AwardsGrid
                regularAwards={regularAwards}
                runnerUpAwards={runnerUpAwards}
                awardCount={awards.length}
              />
            </main>
          </div>

          <FinalStatGrid player={player} leaders={leaders} />
        </div>
      </div>
    </div>
  );
}
