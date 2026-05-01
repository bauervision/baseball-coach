"use client";

import * as React from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";

import { useRosterPlayers } from "@/lib/rosterStore";
import {
  getTrophyDefinitions,
  computeTrophies,
  type TrophyTone,
  type TrophyAward,
} from "@/lib/trophies";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/Dialog";

type TrophyDef = {
  key: string;
  title: string;
  subtitle: string;
  tone?: TrophyTone;
};

function toneVar(tone?: TrophyDef["tone"]) {
  return tone === "secondary"
    ? "var(--secondary)"
    : tone === "accent"
      ? "var(--accent)"
      : tone === "accent2"
        ? "var(--accent-2)"
        : "var(--primary)";
}

export default function TrophiesClient() {
  const { meta, players, error } = useRosterPlayers();
  const [openHow, setOpenHow] = React.useState(false);

  const trophies = React.useMemo(() => getTrophyDefinitions(), []);
  const awards = React.useMemo(() => computeTrophies(players ?? []), [players]);

  const awardByKey = React.useMemo(() => {
    const map = new Map<string, TrophyAward>();
    for (const award of awards) {
      map.set(award.trophy.key, award);
    }
    return map;
  }, [awards]);

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Trophy Case</CardTitle>
          <CardSubtitle>Failed to load roster</CardSubtitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {error}
          </div>
          <Link
            href="/"
            className="text-sm font-semibold underline underline-offset-4"
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
          <CardTitle>Trophy Case</CardTitle>
          <CardSubtitle>Loading…</CardSubtitle>
        </CardHeader>
        <CardContent>
          <Link
            href="/"
            className="text-sm font-semibold underline underline-offset-4"
            style={{ color: "var(--muted)" }}
          >
            Back to roster
          </Link>
        </CardContent>
      </Card>
    );
  }

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
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle style={{ color: "var(--secondary)" }}>
                Trophy Case
              </CardTitle>
              <CardSubtitle>
                Reveal strengths across the whole season
              </CardSubtitle>
            </div>

            <div className="shrink-0">
              <Button variant="secondary" onClick={() => setOpenHow(true)}>
                How trophies work
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4">
          <div
            className="rounded-2xl border px-4 py-3 text-sm"
            style={{
              borderColor:
                "color-mix(in oklab, var(--stroke) 92%, transparent)",
              background:
                "color-mix(in oklab, var(--bg-base) 65%, transparent)",
              color: "var(--muted)",
            }}
          >
            Every Tiger should be recognized for a real strength. Some trophies
            will not have an active leader yet early in the season, but this
            page shows the full set of awards that can come into play.
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trophies.map((t) => (
              <TrophyTile
                key={t.key}
                trophy={t}
                award={awardByKey.get(t.key) ?? null}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={openHow} onOpenChangeAction={setOpenHow}>
        <DialogContent
          title="How trophies are calculated"
          description="Simple, stat-based, and designed to reveal strengths across the roster."
          className="max-w-lg"
        >
          <div className="grid gap-3 text-sm" style={{ color: "var(--muted)" }}>
            <div>
              <div
                className="font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                1) Every trophy points to a strength
              </div>
              <div className="mt-1">
                Some awards reward production, some reward power, some reward
                toughness, speed, pitching, or defense. The goal is not just to
                hand out leftovers — it is to spotlight what each player does
                well.
              </div>
            </div>

            <div>
              <div
                className="font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                2) Some trophies need real stats before they activate
              </div>
              <div className="mt-1">
                If nobody has a put out, assist, pitching save, stolen base, or
                other tracked event yet, that trophy still appears here as part
                of the season award set, but it will not show an active leader
                until the team records those stats.
              </div>
            </div>

            <div>
              <div
                className="font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                3) Rate stats still use minimum qualifiers
              </div>
              <div className="mt-1">
                AVG, OBP, SLG, and OPS use minimum chances so one small sample
                does not unfairly dominate early.
              </div>
            </div>

            <div>
              <div
                className="font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                4) The goal is to reveal strengths, not punish roles
              </div>
              <div className="mt-1">
                We want awards that feel meaningful. That is why the trophy set
                includes specialty awards like Singles, Doubles, Speed, Pitching
                Strikeouts, and position-based fielding recognition.
              </div>
            </div>

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
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TrophyTile(props: { trophy: TrophyDef; award: TrophyAward | null }) {
  const { trophy, award } = props;
  const tone = toneVar(trophy.tone);

  return (
    <div
      className="rounded-2xl border p-5"
      style={{
        borderColor: `color-mix(in oklab, ${tone} 45%, transparent)`,
        background: `linear-gradient(180deg,
          color-mix(in oklab, ${tone} 14%, var(--card)),
          color-mix(in oklab, var(--bg-base) 62%, transparent)
        )`,
        boxShadow: `0 0 0 1px color-mix(in oklab, ${tone} 12%, transparent) inset`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-extrabold leading-tight">
            {trophy.title}
          </div>
          <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            {trophy.subtitle}
          </div>
        </div>

        <div
          className="grid h-14 w-14 place-items-center rounded-2xl border"
          style={{
            borderColor: `color-mix(in oklab, ${tone} 40%, transparent)`,
            background: `color-mix(in oklab, ${tone} 14%, var(--card))`,
            boxShadow: `0 10px 28px color-mix(in oklab, ${tone} 18%, transparent)`,
          }}
          aria-hidden="true"
        >
          <Trophy
            className="h-8 w-8"
            style={{
              color: `color-mix(in oklab, ${tone} 82%, var(--foreground))`,
              filter:
                "drop-shadow(0 10px 18px color-mix(in oklab, var(--stroke) 45%, transparent))",
              opacity: 0.95,
            }}
          />
        </div>
      </div>

      {award ? (
        <div
          className="mt-4 rounded-xl border px-3 py-3"
          style={{
            borderColor: `color-mix(in oklab, ${tone} 28%, transparent)`,
            background: `color-mix(in oklab, ${tone} 10%, var(--bg-base))`,
          }}
        >
          <div className="text-xs font-semibold" style={{ color: tone }}>
            Current leader{award.leaders.length > 1 ? "s" : ""}
          </div>

          <div
            className="mt-1 text-sm font-extrabold leading-tight"
            style={{ color: "var(--foreground)" }}
          >
            {award.leaders.map((p) => p.name).join(", ")}
          </div>

          <div className="mt-1 text-xs font-semibold" style={{ color: tone }}>
            {award.valueLabel}
          </div>

          {award.valueSub ? (
            <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              {award.valueSub}
            </div>
          ) : null}

          {award.runnerUp ? (
            <div
              className="mt-3 rounded-lg border px-2 py-2 text-xs"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--stroke) 88%, transparent)",
                background:
                  "color-mix(in oklab, var(--bg-base) 65%, transparent)",
                color: "var(--muted)",
              }}
            >
              <span style={{ color: "var(--foreground)", fontWeight: 800 }}>
                Runner-up:
              </span>{" "}
              {award.runnerUp.name}
            </div>
          ) : null}

          {award.leaders.length > 1 ? (
            <div className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
              Tied leaders
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className="mt-4 rounded-xl border px-3 py-2 text-xs font-semibold"
          style={{
            borderColor: "color-mix(in oklab, var(--stroke) 88%, transparent)",
            background: "color-mix(in oklab, var(--bg-base) 65%, transparent)",
            color: "var(--muted)",
          }}
        >
          Available this season
        </div>
      )}
    </div>
  );
}
