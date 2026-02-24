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

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/Dialog";

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
    description: "How often a player reaches base (hit, walk, or hit by pitch).",
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

  const [activeStat, setActiveStat] = React.useState<StatKey | null>(null);

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
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="text-sm font-semibold underline underline-offset-4"
          style={{ color: "var(--muted)" }}
        >
          Back
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
              <CardTitle
                className="leading-none"
                style={{ color: "var(--secondary)" }}
              >
                {player.name}
              </CardTitle>
              {player.primaryPos ? (
                <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  {player.primaryPos}
                </div>
              ) : null}
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
            <SmallStat label="Games Played" value={String(player.stats.games)} />
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
              label="Strike Outs"
              value={String(player.stats.strikeouts)}
            />
            <SmallStat
              label="Hit By Pitch"
              value={String(player.stats.hitByPitch)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Trends</CardTitle>
              <CardSubtitle>Stub for now (next step: last N games)</CardSubtitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Next we’ll add a small “last 5 games” strip and a simple
                sparkline.
              </div>
            </CardContent>
          </Card>
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
      <path
        d="M12 3l8 9-8 9-8-9 8-9z"
        stroke="currentColor"
        strokeWidth="2"
      />
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