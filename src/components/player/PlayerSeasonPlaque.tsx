"use client";

import Image from "next/image";
import * as React from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import type { Player, LeadersMap, StatKey } from "@/lib/roster";
import {
  battingAverage,
  fmt3,
  onBasePercentage,
  ops,
  slugging,
} from "@/lib/roster";
import type { TrophyAward, RunnerUpAward, TrophyDef } from "@/lib/trophies";
import { isFinalCoachAwardKey } from "@/lib/trophies";
import { TROPHY_ART } from "@/lib/trophyArtwork";
import {
  autoCardKeys,
  earnedCardKey,
  reconcileOrder,
  runnerUpCardKey,
  visibleSlotCount,
} from "@/lib/recognitionLayout";
import type { PlayerBestGame } from "@/components/player/playerBestGame";

// The recognition sheet is a fixed 10in x 8in (landscape 8x10) canvas. The
// same component renders the on-screen preview (scaled to fit), the browser
// print copy, and the PDF raster, so all three always agree.
export const SHEET_WIDTH_PX = 960;
export const SHEET_HEIGHT_PX = 768;

// Print-friendly palette: light surfaces, dark ink, Tigers orange and gold
// as accents. Fixed values (not theme tokens) so dark mode never leaks into
// a printed sheet.
const INK = "#1f1b16";
const MUTED = "#5b5248";
const ORANGE = "#d9480f";
const BRAND_ORANGE = "#ff4d00";
const GOLD = "#efa243";
const GOLD_LINE = "#d9a35a";
const PAPER = "#fffdf8";
const CARD = "#ffffff";

type StatItem = {
  label: string;
  value: string;
  leader: boolean;
};

export type PlaqueAwardCard = {
  key: string;
  trophy: TrophyDef;
  kind: "earned" | "runnerUp";
  /** The player's own value for the award's deciding statistic. */
  stat: AwardStat | null;
};

type AwardStat = { value: string; unit: string };

// What each statistical award's deciding value measures, as [one, many].
// Values come from the trophy engine's own formatter for that award, so the
// sheet always shows the exact metric that earned it. Awards decided by
// coach picks rather than statistics keep their description instead.
const AWARD_STAT_UNITS: Record<string, readonly [string, string]> = {
  batting_champ: ["Batting Average", "Batting Average"],
  on_base_king: ["On-Base Percentage", "On-Base Percentage"],
  slugger: ["Slugging Percentage", "Slugging Percentage"],
  ops_star: ["OPS", "OPS"],
  rbi_producer: ["RBI", "RBIs"],
  run_machine: ["Run Scored", "Runs Scored"],
  hit_leader: ["Hit", "Hits"],
  hot_streak_hitter: ["Game Hit Streak", "Game Hit Streak"],
  iron_tiger: ["Game Played", "Games Played"],
  walk_wizard: ["Walk", "Walks"],
  tough_as_nails: ["Hit By Pitch", "Hit By Pitches"],
  singles_specialist: ["Single", "Singles"],
  doubles_machine: ["Double", "Doubles"],
  triples_king: ["Triple", "Triples"],
  home_run_king: ["Home Run", "Home Runs"],
  strikeout_ace: ["Strikeout", "Strikeouts"],
  speed_demon: ["Stolen Base", "Stolen Bases"],
  gold_glove: ["Putout", "Putouts"],
  cannon_arm: ["Assist", "Assists"],
  flyball_trapper: ["Fly Ball Caught", "Fly Balls Caught"],
  closer: ["Save", "Saves"],
};

function awardStat(
  award: TrophyAward | RunnerUpAward,
  player: Player | null,
): AwardStat | null {
  const units = AWARD_STAT_UNITS[award.trophy.key];
  if (!units || !award.valueFor || !player) return null;
  const { valueLabel } = award.valueFor(player);
  return { value: valueLabel, unit: valueLabel === "1" ? units[0] : units[1] };
}

const TIGERS_ORANGE_FILTER =
  "brightness(0) saturate(100%) invert(49%) sepia(98%) saturate(1901%) hue-rotate(2deg) brightness(101%) contrast(101%)";

function trophyArt(trophy: TrophyDef): string {
  return TROPHY_ART[trophy.key] ?? "/trophies/trophy.png";
}

export type RecognitionCards = {
  /** The player's special Coach's Award, shown in Coach Recognition. */
  coachAward: TrophyAward | null;
  /** Award cards in slot order (saved arrangement applied). */
  cards: PlaqueAwardCard[];
  /** Card keys in automatic order. */
  autoOrder: string[];
  /** Card keys in slot order. */
  order: string[];
  /** Slots pictured on the sheet; later slots are counted but not shown. */
  visibleCount: number;
  honorCount: number;
};

/**
 * Splits a player's awards into the Coach Recognition award and the slotted
 * award cards, applying a saved arrangement when one exists.
 */
export function buildRecognitionCards(opts: {
  player: Player | null;
  awards: TrophyAward[];
  runnerUpAwards: RunnerUpAward[];
  savedOrder?: readonly string[] | null;
}): RecognitionCards {
  const { player, awards, runnerUpAwards, savedOrder } = opts;

  const coachAward =
    awards.find((award) => isFinalCoachAwardKey(award.trophy.key)) ?? null;
  const regularAwards = awards.filter(
    (award) => !isFinalCoachAwardKey(award.trophy.key),
  );

  const byKey = new Map<string, PlaqueAwardCard>();
  for (const award of regularAwards) {
    const key = earnedCardKey(award.trophy.key);
    byKey.set(key, {
      key,
      trophy: award.trophy,
      kind: "earned",
      stat: awardStat(award, player),
    });
  }
  for (const award of runnerUpAwards) {
    const key = runnerUpCardKey(award.trophy.key);
    byKey.set(key, {
      key,
      trophy: award.trophy,
      kind: "runnerUp",
      stat: awardStat(award, player),
    });
  }

  const autoOrder = autoCardKeys(
    regularAwards.map((award) => award.trophy.key),
    runnerUpAwards.map((award) => award.trophy.key),
  );
  const order = reconcileOrder(autoOrder, savedOrder);
  const cards = order.map((key) => byKey.get(key) as PlaqueAwardCard);

  return {
    coachAward,
    cards,
    autoOrder,
    order,
    visibleCount: visibleSlotCount(cards.length, awards.length),
    honorCount: awards.length,
  };
}

/**
 * Lets the arrangement editor attach drag, keyboard, and highlight behavior
 * to award slots without the sheet knowing about editing. Absent (print,
 * PDF, parent view) the slots are plain layout boxes.
 */
export type RecognitionSlotBinding = {
  slotProps: (index: number) => HTMLAttributes<HTMLDivElement>;
  overlay: (index: number) => ReactNode;
};

const SlotBindingContext = React.createContext<RecognitionSlotBinding | null>(
  null,
);

export const RecognitionSlotProvider = SlotBindingContext.Provider;

export function useRecognitionSlotBinding(): RecognitionSlotBinding | null {
  return React.useContext(SlotBindingContext);
}

function Slot(props: {
  index: number;
  className?: string;
  children: ReactNode;
}) {
  const { index, className = "", children } = props;
  const binding = React.useContext(SlotBindingContext);

  return (
    <div
      data-slot={index}
      className={`relative grid min-h-0 min-w-0 ${className}`}
      {...binding?.slotProps(index)}
    >
      {children}
      {binding?.overlay(index)}
    </div>
  );
}

/**
 * Keeps text inside its box without clipping: it wraps only between words,
 * and shrinks from `max` toward `min` until it is no wider than its box and
 * no taller than `maxLines` lines, so long names, titles, and labels stay
 * whole and legible at print size.
 */
function FitText(props: {
  children: ReactNode;
  max: number;
  min: number;
  maxLines: number;
  lineHeight?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const {
    children,
    max,
    min,
    maxLines,
    lineHeight = 1,
    className = "",
    style,
  } = props;
  const ref = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState(max);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // scrollWidth rounds to whole pixels, so compare the text's exact
    // rendered extent against the box instead.
    const range = document.createRange();
    range.selectNodeContents(el);
    const fitsWidth = () => {
      const box = el.getBoundingClientRect();
      return Array.from(range.getClientRects()).every(
        (r) => r.left >= box.left - 0.01 && r.right <= box.right + 0.01,
      );
    };

    let next = max;
    for (; next > min; next -= 1) {
      el.style.fontSize = `${next}px`;
      const lines = el.scrollHeight / (next * lineHeight);
      if (fitsWidth() && lines <= maxLines + 0.25) {
        break;
      }
    }
    el.style.fontSize = `${next}px`;
    setSize(next);
  }, [children, max, min, maxLines, lineHeight]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        fontSize: size,
        lineHeight,
        overflowWrap: "normal",
        wordBreak: "keep-all",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Award artwork, always shown whole: the square art is sized to the largest
 * square that fits its box (contain), never cropped or stretched.
 */
function ArtTile(props: {
  src: string;
  alt: string;
  radius?: number;
  imgStyle?: CSSProperties;
}) {
  const { src, alt, radius = 14, imgStyle } = props;

  return (
    <div
      className="grid h-full min-h-0 w-full min-w-0 place-items-center"
      style={{ containerType: "size" }}
    >
      <Image
        src={src}
        alt={alt}
        width={512}
        height={512}
        loading="eager"
        draggable={false}
        style={{
          width: "100cqmin",
          height: "100cqmin",
          objectFit: "contain",
          borderRadius: radius,
          ...imgStyle,
        }}
      />
    </div>
  );
}

function Panel(props: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { children, className = "", style } = props;

  return (
    <section
      className={`overflow-hidden rounded-[16px] border ${className}`}
      style={{
        borderColor: GOLD_LINE,
        background: CARD,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

function SectionLabel(props: { children: ReactNode }) {
  return (
    <div
      className="text-[10px] font-black uppercase tracking-[0.24em]"
      style={{ color: ORANGE }}
    >
      {props.children}
    </div>
  );
}

function EarnedBadge(props: { isRunnerUp: boolean }) {
  const { isRunnerUp } = props;

  return (
    <div
      className="mt-2 inline-flex rounded-full border px-2.5 py-[3px] text-[9.5px] font-black uppercase tracking-wide"
      style={{
        background: isRunnerUp ? "#f1efec" : GOLD,
        borderColor: isRunnerUp ? "#cfc8bf" : "#d98a26",
        color: INK,
      }}
    >
      {isRunnerUp ? "Runner Up" : "Earned"}
    </div>
  );
}

function BestGamePanel(props: { bestGame: PlayerBestGame }) {
  const { bestGame } = props;

  return (
    <Panel className="px-4 py-3">
      <SectionLabel>Best Game</SectionLabel>

      <FitText
        max={17}
        min={11}
        maxLines={2}
        lineHeight={1.2}
        className="mt-1 font-black"
      >
        {bestGame.date} vs {bestGame.opponent}
      </FitText>

      <FitText
        max={13}
        min={9}
        maxLines={2}
        lineHeight={1.3}
        className="mt-0.5 font-semibold"
        style={{ color: MUTED }}
      >
        {bestGame.lineSummary}
      </FitText>

      <div
        className="mt-1 text-[11px] font-black uppercase tracking-wide"
        style={{ color: ORANGE }}
      >
        {bestGame.result} {bestGame.scoreUs}-{bestGame.scoreThem}
      </div>
    </Panel>
  );
}

function CoachRecognitionPanel(props: {
  seasonLabel: string;
  coachAward: TrophyAward | null;
}) {
  const { seasonLabel, coachAward } = props;

  return (
    <Panel
      className={`flex min-h-0 flex-col pb-3 pt-3 ${coachAward ? "px-3" : "px-4"}`}
      style={{ background: PAPER }}
    >
      <div className="flex items-center gap-3">
        <SectionLabel>Coach Recognition</SectionLabel>
        <div
          className="h-px flex-1"
          style={{
            background: `linear-gradient(90deg, ${GOLD_LINE}, transparent)`,
          }}
        />
      </div>

      {coachAward ? (
        // A special Coach's Award: the artwork is the recognition, shown
        // as large as the panel allows with no caption.
        <div className="min-h-0 flex-1 pt-2.5">
          <ArtTile
            src={trophyArt(coachAward.trophy)}
            alt={coachAward.trophy.title}
            radius={16}
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto] gap-2.5 pt-3 text-center">
          <ArtTile
            src="/TigersLogo.png"
            alt="Tigers Baseball"
            radius={0}
            imgStyle={{ filter: TIGERS_ORANGE_FILTER }}
          />

          <div>
            <div className="text-[24px] font-black leading-none">
              Tigers Baseball
            </div>

            <div
              className="mt-1.5 text-[10px] font-black uppercase tracking-[0.28em]"
              style={{ color: ORANGE }}
            >
              {seasonLabel}
            </div>

            <div
              className="mx-auto mt-2 max-w-[250px] text-[10.5px] font-semibold leading-snug"
              style={{ color: MUTED }}
            >
              Thank you for the energy, effort, teamwork, and heart you brought
              to the Tigers this season. Every practice, every game, and every
              moment helped shape this team.
            </div>

            <div
              className="mt-1.5 text-[10.5px] font-semibold italic"
              style={{ color: MUTED }}
            >
              — Coaching Staff
            </div>
          </div>
        </div>
      )}
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
    {
      label: "FB",
      value: String(s.flyBallCatches),
      leader: isLeader("flyBallCatches"),
    },
    {
      label: "SV",
      value: String(s.pitchingSaves),
      leader: isLeader("pitchingSaves"),
    },
    {
      label: "HBP",
      value: String(s.hitByPitch),
      leader: isLeader("hitByPitch"),
    },
  ];

  return (
    <section
      className="overflow-hidden rounded-[16px] border-[1.5px] px-5 py-3"
      style={{ borderColor: INK, background: CARD }}
    >
      <div className="grid grid-cols-[78px_1fr] items-center gap-4">
        <div>
          <div
            className="text-[14px] font-black uppercase leading-tight tracking-[0.2em]"
            style={{ color: ORANGE }}
          >
            Final
            <br />
            Stats
          </div>
          {stats.some((item) => item.leader) ? (
            <div
              className="mt-1.5 flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-wide"
              style={{ color: MUTED }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: BRAND_ORANGE }}
              />
              Team leader
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-11 gap-y-2.5">
          {stats.map((item, i) => (
            <div
              key={item.label}
              className="px-1 text-center"
              style={{
                borderLeft: i % 11 === 0 ? "none" : "1px solid #e6dccd",
              }}
            >
              <div
                className="text-[10.5px] font-black uppercase leading-none tracking-[0.08em]"
                style={{ color: MUTED }}
              >
                {item.label}
              </div>

              <div
                className="mt-1 text-[19px] font-black leading-none"
                style={{ color: item.leader ? BRAND_ORANGE : INK }}
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

/** The player's actual achievement, or the award's description. */
function AwardDetail(props: { card: PlaqueAwardCard }) {
  const { card } = props;

  if (card.stat) {
    return (
      <>
        <span className="font-black" style={{ color: INK }}>
          {card.stat.value}
        </span>{" "}
        {card.stat.unit}
      </>
    );
  }

  return card.kind === "runnerUp" ? "Runner-up performance" : card.trophy.subtitle;
}

function HeroAwardCard(props: { card: PlaqueAwardCard }) {
  const { card } = props;

  return (
    <Panel
      className="grid min-h-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] items-center gap-4 p-3"
      style={{ borderColor: GOLD, borderWidth: 2 }}
    >
      <ArtTile src={trophyArt(card.trophy)} alt={card.trophy.title} radius={14} />

      <div className="min-w-0 pr-2 text-center">
        <div
          className="text-[10px] font-black uppercase tracking-[0.26em]"
          style={{ color: MUTED }}
        >
          Featured Award
        </div>

        <FitText
          max={46}
          min={22}
          maxLines={2}
          lineHeight={1}
          className="mt-2 font-black uppercase tracking-tight"
          style={{ color: ORANGE }}
        >
          {card.trophy.title}
        </FitText>

        <div
          className="mx-auto mt-3 h-[2px] w-40"
          style={{
            background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
          }}
        />

        <FitText
          max={16}
          min={11}
          maxLines={2}
          lineHeight={1.25}
          className="mt-3 font-bold"
        >
          <AwardDetail card={card} />
        </FitText>

        <EarnedBadge isRunnerUp={card.kind === "runnerUp"} />
      </div>
    </Panel>
  );
}

function SmallAwardCard(props: { card: PlaqueAwardCard }) {
  const { card } = props;

  return (
    <Panel className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 p-2.5">
      <ArtTile src={trophyArt(card.trophy)} alt={card.trophy.title} radius={12} />

      <div className="min-w-0 pr-1">
        <FitText
          max={21}
          min={12}
          maxLines={3}
          lineHeight={1}
          className="font-black uppercase"
        >
          {card.trophy.title}
        </FitText>

        <FitText
          max={12}
          min={9}
          maxLines={3}
          lineHeight={1.25}
          className="mt-1.5 font-semibold"
          style={{ color: MUTED }}
        >
          <AwardDetail card={card} />
        </FitText>

        <EarnedBadge isRunnerUp={card.kind === "runnerUp"} />
      </div>
    </Panel>
  );
}

function HonorsCount(props: { count: number; compact?: boolean }) {
  const { count, compact = false } = props;

  return (
    <div className="text-center">
      <div
        className={`${compact ? "text-[40px]" : "text-[46px]"} font-black leading-none`}
        style={{ color: ORANGE }}
      >
        {count}
      </div>

      <div
        className={`mt-1.5 font-black uppercase leading-tight ${
          compact ? "text-[12.5px] tracking-[0.1em]" : "text-[15px] tracking-[0.16em]"
        }`}
      >
        Honors
        <br />
        Earned
      </div>

      <div
        className="mx-auto mt-2.5 h-1 w-14 rounded-full"
        style={{ background: GOLD }}
      />
    </div>
  );
}

function HonorsSummaryCard(props: {
  honorCount: number;
  thumbnails: PlaqueAwardCard[];
  firstThumbnailSlot: number;
}) {
  const { honorCount, thumbnails, firstThumbnailSlot } = props;

  if (thumbnails.length === 0) {
    return (
      <Panel className="grid min-h-0 place-items-center p-4">
        <HonorsCount count={honorCount} />
      </Panel>
    );
  }

  return (
    <Panel className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 p-3">
      <HonorsCount count={honorCount} compact />

      <div
        className="grid h-full min-h-0 gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${thumbnails.length}, minmax(0, 1fr))`,
        }}
      >
        {thumbnails.map((card, i) => (
          <Slot key={card.key} index={firstThumbnailSlot + i}>
            <div className="grid min-h-0 grid-rows-[1fr_auto] text-center">
              <ArtTile src={trophyArt(card.trophy)} alt={card.trophy.title} radius={10} />
              <FitText
                max={9}
                min={6}
                maxLines={3}
                lineHeight={1.1}
                className="mt-1 font-black uppercase"
              >
                {card.trophy.title}
              </FitText>
            </div>
          </Slot>
        ))}
      </div>
    </Panel>
  );
}

function TeamContributorCard() {
  return (
    <Panel className="grid min-h-0 place-items-center p-8 text-center">
      <div>
        <div className="text-[40px] font-black uppercase">Team Contributor</div>

        <div
          className="mx-auto mt-3 max-w-md text-[14px] font-semibold leading-relaxed"
          style={{ color: MUTED }}
        >
          A valued part of the Tigers season — showing up, competing, and
          helping the team grow.
        </div>
      </div>
    </Panel>
  );
}

function AwardsGrid(props: { recognition: RecognitionCards }) {
  const { cards, visibleCount, honorCount } = props.recognition;

  if (cards.length === 0) {
    return <TeamContributorCard />;
  }

  const panel = (index: number) => (
    <Slot index={index}>
      {index === 0 ? (
        <HeroAwardCard card={cards[0]} />
      ) : (
        <SmallAwardCard card={cards[index]} />
      )}
    </Slot>
  );

  const honors = (
    <HonorsSummaryCard
      honorCount={honorCount}
      thumbnails={cards.slice(4, visibleCount)}
      firstThumbnailSlot={4}
    />
  );

  if (cards.length === 1) {
    return (
      <section className="grid min-h-0 grid-rows-[1.45fr_1fr] gap-3">
        {panel(0)}
        {honors}
      </section>
    );
  }

  if (cards.length === 2) {
    return (
      <section className="grid min-h-0 grid-rows-[1.25fr_1fr] gap-3">
        {panel(0)}
        <div className="grid min-h-0 grid-cols-2 gap-3">
          {panel(1)}
          {honors}
        </div>
      </section>
    );
  }

  if (cards.length === 3) {
    return (
      <section className="grid min-h-0 grid-rows-[1.18fr_1fr_0.7fr] gap-3">
        {panel(0)}
        <div className="grid min-h-0 grid-cols-2 gap-3">
          {panel(1)}
          {panel(2)}
        </div>
        {honors}
      </section>
    );
  }

  return (
    <section className="grid min-h-0 grid-rows-[1.18fr_1fr_1fr] gap-3">
      {panel(0)}
      <div className="grid min-h-0 grid-cols-2 gap-3">
        {panel(1)}
        {panel(2)}
      </div>
      <div className="grid min-h-0 grid-cols-2 gap-3">
        {panel(3)}
        {honors}
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
  /** Saved or draft award arrangement (card keys); null = automatic. */
  order?: readonly string[] | null;
  id?: string;
}) {
  const {
    player,
    teamName,
    seasonLabel,
    awards,
    bestGame,
    leaders,
    runnerUpAwards,
    order = null,
    id,
  } = props;

  const recognition = buildRecognitionCards({
    player,
    awards,
    runnerUpAwards,
    savedOrder: order,
  });

  return (
    <div
      id={id}
      className="recognition-sheet relative overflow-hidden"
      style={{
        width: SHEET_WIDTH_PX,
        height: SHEET_HEIGHT_PX,
        color: INK,
        background: PAPER,
        fontFamily: "Arial, Helvetica, sans-serif",
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
      }}
    >
      {/* Thin brand frame inside the print-safe margin. */}
      <div
        className="pointer-events-none absolute inset-[12px] rounded-[20px] border"
        style={{ borderColor: GOLD_LINE }}
      />
      <div
        className="pointer-events-none absolute left-[12px] right-[12px] top-[12px] h-[5px] rounded-t-[20px]"
        style={{
          background: `linear-gradient(90deg, ${BRAND_ORANGE}, ${GOLD})`,
        }}
      />

      <div className="relative grid h-full grid-rows-[minmax(0,1fr)_auto] gap-3 px-[30px] pb-[28px] pt-[30px]">
        <div className="grid min-h-0 grid-cols-[282px_minmax(0,1fr)] gap-4">
          <aside className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3">
            <header>
              <SectionLabel>End of Season Recognition</SectionLabel>

              <FitText
                max={48}
                min={22}
                maxLines={2}
                lineHeight={1}
                className="mt-2 font-black uppercase tracking-tight"
              >
                {player.name}
              </FitText>

              <FitText
                max={13}
                min={9}
                maxLines={2}
                lineHeight={1.25}
                className="mt-2 font-black uppercase tracking-[0.06em]"
                style={{ color: MUTED }}
              >
                #{player.number} • {teamName} • {seasonLabel}
              </FitText>
            </header>

            {bestGame ? <BestGamePanel bestGame={bestGame} /> : <div />}

            <CoachRecognitionPanel
              seasonLabel={seasonLabel}
              coachAward={recognition.coachAward}
            />
          </aside>

          <main className="grid min-h-0">
            <AwardsGrid recognition={recognition} />
          </main>
        </div>

        <FinalStatGrid player={player} leaders={leaders} />
      </div>
    </div>
  );
}
