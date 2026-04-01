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
} from "@/lib/roster";
import { useRosterPlayers } from "@/lib/rosterStore";
import { ArrowLeft, Trophy } from "lucide-react";
import { computeTrophies, type TrophyAward } from "@/lib/trophies";

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
    tip: "Often a better “getting on base” metric than AVG.",
  },
  SLG: {
    title: "Slugging",
    description: "Measures power: extra-base hits count more than singles.",
    formula: "Total Bases ÷ At-Bats",
    tip: "Singles=1, Doubles=2, Triples=3, HR=4 (in total bases).",
  },
  OPS: {
    title: "OPS",
    description:
      "Quick overall hitting number: getting on base + hitting for power.",
    formula: "OBP + SLG",
    tip: "Easy comparison metric. Higher is better.",
  },
};

export default function PlayerPageClient() {
  const sp = useSearchParams();
  const id = (sp.get("id") ?? "").trim();

  const { seasonId, meta, players, error } = useRosterPlayers();

  const player = React.useMemo(() => {
    const list = players ?? [];
    if (!id) return null;
    return list.find((p) => p.id === id) ?? null;
  }, [players, id]);

  const allTrophyAwards = React.useMemo(
    () => computeTrophies(players ?? []),
    [players],
  );

  const playerTrophyAwards = React.useMemo(() => {
    if (!player) return [];
    return allTrophyAwards.filter((award) =>
      award.leaders.some((leader) => leader.id === player.id),
    );
  }, [allTrophyAwards, player]);

  const [activeStat, setActiveStat] = React.useState<StatKey | null>(null);

  const {
    items: gameLog,
    loading: gameLogLoading,
    error: gameLogError,
  } = usePlayerGameLog({
    seasonId,
    playerId: player?.id ?? "",
  });

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

  return (
    <>
      <AnimatedBackgroundSkin />
      <div className="relative z-10 grid gap-5">
        <div className="flex items-center justify-between gap-3">
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

          <div className="text-right">
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              {meta.teamName} • {meta.seasonLabel}
            </div>
          </div>
        </div>

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
                  className="text-5xl font-extrabold leading-none translate-y-0.5"
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
                onExplainAction={() => openStat("AVG")}
                icon={<IconBat />}
              />
              <BigStat
                label="On-Base Percentage"
                value={fmt3(obp)}
                tone="accent"
                onExplainAction={() => openStat("OBP")}
                icon={<IconDiamond />}
              />
              <BigStat
                label="Slugging"
                value={fmt3(slgV)}
                tone="secondary"
                onExplainAction={() => openStat("SLG")}
                icon={<IconBall />}
              />
              <BigStat
                label="OPS"
                value={fmt3(opsV)}
                tone="accent2"
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
              <SmallStat label="At Bats" value={String(player.stats.atBats)} />
              <SmallStat label="Hits" value={String(player.stats.hits)} />
              <SmallStat label="Doubles" value={String(player.stats.doubles)} />
              <SmallStat label="Triples" value={String(player.stats.triples)} />
              <SmallStat
                label="Home Runs"
                value={String(player.stats.homeRuns)}
              />
              <SmallStat
                label="RBIs: Runs Batted In"
                value={String(player.stats.rbi)}
              />
              <SmallStat label="Runs" value={String(player.stats.runs)} />
              <SmallStat
                label="Base on Balls (Walk)"
                value={String(player.stats.walks)}
              />
              <SmallStat
                label="Hit By Pitch"
                value={String(player.stats.hitByPitch)}
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
                  />
                  <SmallStat
                    label="Put Outs (PO)"
                    value={String(player.stats.putOuts)}
                  />
                  <SmallStat
                    label="Assists (A)"
                    value={String(player.stats.assists)}
                  />
                </div>

                <div className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
                  Example: SS → 1B groundout is usually Assist for SS and Put
                  Out for 1B.
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
                    {gameLog.map((item) => (
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
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <PlayerTrophyHero
              playerName={player.name}
              awards={playerTrophyAwards}
            />
          </CardContent>
        </Card>

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
                    className="text-[10px] font-semibold tracking-wide uppercase"
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

function PlayerTrophyHero(props: {
  playerName: string;
  awards: TrophyAward[];
}) {
  const { playerName, awards } = props;

  return (
    <div
      className="rounded-3xl border p-5 sm:p-6"
      style={{
        borderColor: "color-mix(in oklab, var(--secondary) 42%, transparent)",
        background:
          "linear-gradient(135deg, color-mix(in oklab, var(--secondary) 18%, var(--card)), color-mix(in oklab, var(--primary) 12%, var(--card)) 48%, color-mix(in oklab, var(--bg-base) 72%, transparent))",
        boxShadow:
          "0 0 0 1px color-mix(in oklab, var(--secondary) 12%, transparent) inset, 0 18px 40px color-mix(in oklab, var(--stroke) 20%, transparent)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--muted)" }}
          >
            Trophy Outlook
          </div>

          <div
            className="mt-2 text-xl sm:text-2xl font-extrabold leading-tight"
            style={{ color: "var(--foreground)" }}
          >
            {awards.length > 0
              ? `${playerName} currently has the edge`
              : `${playerName} is still chasing a trophy`}
          </div>

          <div
            className="mt-2 text-sm sm:text-base"
            style={{ color: "var(--muted)" }}
          >
            {awards.length > 0
              ? "A player will ultimately receive one trophy, but these are the categories where they currently lead or are tied for the lead."
              : "No active trophy lead yet. Keep recording games and strengths will start to separate."}
          </div>
        </div>

        <div
          className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border"
          style={{
            borderColor:
              "color-mix(in oklab, var(--secondary) 40%, transparent)",
            background:
              "color-mix(in oklab, var(--secondary) 14%, var(--card))",
            boxShadow:
              "0 12px 28px color-mix(in oklab, var(--secondary) 18%, transparent)",
          }}
          aria-hidden="true"
        >
          <Trophy
            className="h-8 w-8"
            style={{
              color:
                "color-mix(in oklab, var(--secondary) 82%, var(--foreground))",
              filter:
                "drop-shadow(0 10px 18px color-mix(in oklab, var(--stroke) 45%, transparent))",
            }}
          />
        </div>
      </div>

      {awards.length > 0 ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {awards.map((award) => (
            <div
              key={award.trophy.key}
              className="rounded-2xl border px-4 py-3"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--stroke) 88%, transparent)",
                background:
                  "color-mix(in oklab, var(--bg-base) 58%, transparent)",
              }}
            >
              <div
                className="text-sm font-extrabold leading-tight"
                style={{ color: "var(--foreground)" }}
              >
                {award.trophy.title}
              </div>

              <div
                className="mt-1 text-xs font-semibold"
                style={{ color: "var(--secondary)" }}
              >
                {award.valueLabel}
              </div>

              {award.valueSub ? (
                <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  {award.valueSub}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div
          className="mt-5 rounded-2xl border px-4 py-3 text-sm"
          style={{
            borderColor: "color-mix(in oklab, var(--stroke) 88%, transparent)",
            background: "color-mix(in oklab, var(--bg-base) 58%, transparent)",
            color: "var(--muted)",
          }}
        >
          No current trophy lead yet.
        </div>
      )}
    </div>
  );
}

function BigStat(props: {
  label: string;
  value: string;
  tone?: "primary" | "secondary" | "accent" | "accent2";
  icon?: React.ReactNode;
  onExplainAction?: () => void;
}) {
  const toneVar =
    props.tone === "secondary"
      ? "var(--secondary)"
      : props.tone === "accent"
        ? "var(--accent)"
        : props.tone === "accent2"
          ? "var(--accent-2)"
          : "var(--primary)";

  const clickable = typeof props.onExplainAction === "function";
  const Wrapper: "button" | "div" = clickable ? "button" : "div";

  return (
    <Wrapper
      type={clickable ? "button" : undefined}
      onClick={props.onExplainAction}
      className={[
        "rounded-2xl border p-4 text-left",
        clickable ? "transition active:scale-[0.99] hover:opacity-95" : "",
      ].join(" ")}
      style={{
        borderColor: `color-mix(in oklab, ${toneVar} 45%, transparent)`,
        background: `linear-gradient(180deg,
          color-mix(in oklab, ${toneVar} 18%, var(--card)),
          color-mix(in oklab, var(--bg-base) 55%, transparent)
        )`,
        boxShadow: `0 0 0 1px color-mix(in oklab, ${toneVar} 14%, transparent) inset`,
        cursor: clickable ? "pointer" : "default",
      }}
      aria-label={clickable ? `What is ${props.label}?` : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color: "var(--muted)" }}
        >
          {props.label}
        </div>

        {props.icon ? (
          <div
            className="shrink-0 grid h-9 w-9 place-items-center rounded-xl"
            style={{
              background: `color-mix(in oklab, ${toneVar} 14%, var(--card))`,
              border: `1px solid color-mix(in oklab, ${toneVar} 32%, transparent)`,
              boxShadow: `0 0 0 1px color-mix(in oklab, ${toneVar} 10%, transparent) inset,
                          0 10px 24px color-mix(in oklab, ${toneVar} 18%, transparent)`,
              transform: "rotate(-10deg)",
              color: `color-mix(in oklab, ${toneVar} 78%, var(--foreground))`,
              opacity: 0.9,
            }}
            aria-hidden="true"
          >
            <div style={{ transform: "rotate(10deg)" }}>{props.icon}</div>
          </div>
        ) : null}
      </div>

      <div className="mt-1 text-2xl font-semibold">{props.value}</div>

      {clickable ? (
        <div className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
          Tap to learn
        </div>
      ) : null}
    </Wrapper>
  );
}

function SmallStat(props: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl border px-3 py-2"
      style={{
        borderColor: "color-mix(in oklab, var(--stroke) 88%, transparent)",
        background: "color-mix(in oklab, var(--bg-base) 65%, transparent)",
      }}
    >
      <div
        className="text-[10px] font-semibold tracking-wide uppercase"
        style={{ color: "var(--muted)" }}
      >
        {props.label}
      </div>
      <div className="text-sm font-semibold">{props.value}</div>
    </div>
  );
}

function formatGameDate(dateISO: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return dateISO;

  const month = String(Number(m[2]));
  const day = String(Number(m[3]));
  return `${month}/${day}`;
}

function buildLineSummary(props: {
  atBats: number;
  hits: number;
  runs: number;
  rbi: number;
  walks: number;
  hitByPitch: number;
}): string {
  const bits: string[] = [];

  bits.push(`${props.hits} for ${props.atBats}`);

  if (props.runs > 0) {
    bits.push(`${props.runs} ${props.runs === 1 ? "run" : "runs"}`);
  }

  if (props.rbi > 0) {
    bits.push(`${props.rbi} RBI`);
  }

  if (props.walks > 0) {
    bits.push(`${props.walks} BB`);
  }

  if (props.hitByPitch > 0) {
    bits.push(`${props.hitByPitch} HBP`);
  }

  return bits.join(" • ");
}

function GameLogRow(props: {
  date: string;
  opponent: string;
  result: "W" | "L" | "T";
  scoreUs: number;
  scoreThem: number;
  atBats: number;
  hits: number;
  runs: number;
  rbi: number;
  walks: number;
  hitByPitch: number;
}) {
  const summary = buildLineSummary({
    atBats: props.atBats,
    hits: props.hits,
    runs: props.runs,
    rbi: props.rbi,
    walks: props.walks,
    hitByPitch: props.hitByPitch,
  });

  return (
    <div
      className="rounded-xl border px-3 py-3"
      style={{
        borderColor: "color-mix(in oklab, var(--stroke) 88%, transparent)",
        background: "color-mix(in oklab, var(--bg-base) 65%, transparent)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {formatGameDate(props.date)} vs {props.opponent}
          </div>
          <div className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {summary}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div
            className="text-xs font-semibold"
            style={{ color: "var(--muted)" }}
          >
            {props.result} {props.scoreUs}-{props.scoreThem}
          </div>
        </div>
      </div>
    </div>
  );
}

function SvgIcon(props: { children: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      {props.children}
    </svg>
  );
}

export function IconBat() {
  return (
    <SvgIcon>
      <path
        d="M6.5 17.5l11-11"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M16.5 6.5l1.8-1.8c.7-.7 1.8-.7 2.5 0 .7.7.7 1.8 0 2.5L19 9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M5 19l2-2"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}

export function IconDiamond() {
  return (
    <SvgIcon>
      <path d="M12 3l8 9-8 9-8-9 8-9z" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </SvgIcon>
  );
}

export function IconBall() {
  return (
    <SvgIcon>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M8.3 6.8c1.2 1 2 2.8 2 5.2s-.8 4.2-2 5.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M15.7 6.8c-1.2 1-2 2.8-2 5.2s.8 4.2 2 5.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}

export function IconScoreboard() {
  return (
    <SvgIcon>
      <rect
        x="5"
        y="6"
        width="14"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M8 10h3M8 14h3M13 10h3M13 14h3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}
