// app/trophies/TrophiesClient.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";

import { useRosterPlayers } from "@/lib/rosterStore";

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
  tone?: "primary" | "secondary" | "accent" | "accent2";
};

const TROPHIES: TrophyDef[] = [
  {
    key: "batting_champ",
    title: "Batting Champ",
    subtitle: "Highest AVG (min 10 AB)",
    tone: "primary",
  },
  {
    key: "on_base_king",
    title: "On-Base King",
    subtitle: "Highest OBP (min 10 PA)",
    tone: "accent",
  },
  {
    key: "slugger",
    title: "Slugger",
    subtitle: "Highest SLG (min 10 AB)",
    tone: "secondary",
  },
  {
    key: "ops_star",
    title: "OPS Star",
    subtitle: "Best all-around (min 10 PA)",
    tone: "accent2",
  },
  {
    key: "rbi_producer",
    title: "RBI Producer",
    subtitle: "Most RBI",
    tone: "primary",
  },
  {
    key: "run_machine",
    title: "Run Machine",
    subtitle: "Most Runs",
    tone: "secondary",
  },
  {
    key: "hit_leader",
    title: "Hit Leader",
    subtitle: "Most Hits",
    tone: "accent",
  },
  {
    key: "iron_tiger",
    title: "Iron Tiger",
    subtitle: "Most Games Played",
    tone: "accent2",
  },
  {
    key: "gold_glove",
    title: "Gold Glove",
    subtitle: "Most Put Outs (PO)",
    tone: "secondary",
  },
  {
    key: "cannon_arm",
    title: "Cannon Arm",
    subtitle: "Most Assists (A)",
    tone: "primary",
  },
  {
    key: "walk_wizard",
    title: "Walk Wizard",
    subtitle: "Most Walks (BB)",
    tone: "accent",
  },
  {
    key: "brick_wall",
    title: "The Brick Wall",
    subtitle: "Most Hit By Pitch (HBP)",
    tone: "accent2",
  },
];

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
              <CardSubtitle>Updates During Season</CardSubtitle>
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
            We’ll keep this page updated as the season goes. Winners won’t show
            until later — every Tiger will earn one unique award.
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TROPHIES.map((t) => (
              <TrophyTile key={t.key} trophy={t} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={openHow} onOpenChangeAction={setOpenHow}>
        <DialogContent
          title="How trophies are calculated"
          description="Simple, stat-based, and designed so every player earns exactly one."
          className="max-w-lg"
        >
          <div className="grid gap-3 text-sm" style={{ color: "var(--muted)" }}>
            <div>
              <div
                className="font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                1) Each trophy has a primary stat
              </div>
              <div className="mt-1">
                Example: Batting Champ uses AVG, RBI Producer uses RBI, Gold
                Glove uses Put Outs (PO), Cannon Arm uses Assists (A), and The
                Brick Wall uses Hit By Pitch (HBP).
              </div>
            </div>

            <div>
              <div
                className="font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                2) Minimum qualifiers prevent weird early-season results
              </div>
              <div className="mt-1">
                Rate stats like AVG/OBP/SLG/OPS require a minimum number of
                chances (AB or PA). Counting stats (RBI, runs, put outs,
                assists) don’t need a qualifier.
              </div>
            </div>

            <div>
              <div
                className="font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                3) Ties use common-sense tie-breakers
              </div>
              <div className="mt-1">
                If two players are tied on the primary stat, we break ties with
                the larger sample (more AB/PA), then other relevant stats, then
                games played. If everything is still tied, we use a
                deterministic fallback (name) so the page is stable.
              </div>
            </div>

            <div>
              <div
                className="font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                4) One trophy per player (unique awards)
              </div>
              <div className="mt-1">
                If a player leads multiple categories, they receive the
                highest-priority trophy first. For the next trophy, we skip
                anyone who already won and award it to the next best player.
                This guarantees every Tiger earns one unique award.
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

function TrophyTile(props: { trophy: TrophyDef }) {
  const { trophy } = props;
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

      <div
        className="mt-4 rounded-xl border px-3 py-2 text-xs font-semibold"
        style={{
          borderColor: "color-mix(in oklab, var(--stroke) 88%, transparent)",
          background: "color-mix(in oklab, var(--bg-base) 65%, transparent)",
          color: "var(--muted)",
        }}
      >
        Updates during season
      </div>
    </div>
  );
}
