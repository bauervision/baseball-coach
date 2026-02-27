//components/roster/Roster.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import {
  battingAverage,
  onBasePercentage,
  slugging,
  ops,
  fmt3,
  computeLeaders,
} from "@/lib/roster";
import { useRosterPlayers } from "@/lib/rosterStore";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import { Stat } from "./Stat";
import { ArrowDown, ArrowUp, Star } from "lucide-react";
import { OpeningDayCountdown } from "./OpeningDayCountdown";

// near top of file
const OPENING_DAY_DATE = "2026-03-28";

function parseLocalMidnight(dateISO: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 0, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function isPreseason(now = new Date()): boolean {
  const target = parseLocalMidnight(OPENING_DAY_DATE);
  if (!target) return false;
  return now.getTime() < target.getTime();
}

function hasAnyRecordedStats(p: {
  stats: {
    atBats: number;
    hits: number;
    doubles: number;
    triples: number;
    homeRuns: number;
    runs: number;
    rbi: number;
    walks: number;
    hitByPitch: number;
  };
}) {
  const s = p.stats;
  const total =
    s.atBats +
    s.hits +
    s.doubles +
    s.triples +
    s.homeRuns +
    s.runs +
    s.rbi +
    s.walks +
    s.hitByPitch;

  return total > 0;
}

function lastNameKey(fullName: string): string {
  const parts = fullName.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];

  // basic: last token is last name
  return parts[parts.length - 1]!;
}

function sortByLastNameThenFirst(aName: string, bName: string): number {
  const aLast = lastNameKey(aName);
  const bLast = lastNameKey(bName);

  const byLast = aLast.localeCompare(bLast);
  if (byLast !== 0) return byLast;

  return aName.localeCompare(bName);
}

type Movement = "star" | "up" | "down" | "none";

/**
 * Stub for now:
 * - later: compare previousRankById vs current idx+1
 * - star: if they've held this position historically
 */
function movementForPlayer(_playerId: string): Movement {
  return "none";
}

function MovementIcon(props: { kind: Movement }) {
  if (props.kind === "none") return null;

  const Icon =
    props.kind === "star" ? Star : props.kind === "up" ? ArrowUp : ArrowDown;

  const tone =
    props.kind === "star"
      ? "var(--secondary)"
      : props.kind === "up"
        ? "var(--primary)"
        : "var(--accent-2)";

  const label =
    props.kind === "star"
      ? "Held position"
      : props.kind === "up"
        ? "Moved up"
        : "Moved down";

  return (
    <div
      className="movementChip"
      aria-label={label}
      title={label}
      style={{
        borderColor: `color-mix(in oklab, ${tone} 32%, transparent)`,
        background: `color-mix(in oklab, ${tone} 12%, transparent)`,
        color: `color-mix(in oklab, ${tone} 75%, var(--foreground))`,
      }}
    >
      <Icon size={16} aria-hidden="true" />
    </div>
  );
}

export function Roster() {
  const { meta, players, error } = useRosterPlayers();

  const anyStatsExist = React.useMemo(() => {
    const src = players ?? [];
    return src.some((p) => hasAnyRecordedStats(p));
  }, [players]);

  const list = React.useMemo(() => {
    const src = players ?? [];
    const arr = [...src];

    if (!anyStatsExist) {
      // Default: last-name alphabetical before any stats are entered.
      arr.sort((a, b) => sortByLastNameThenFirst(a.name, b.name));
      return arr;
    }

    // Once stats exist: BA sort with tie-breakers.
    arr.sort((a, b) => {
      const ba = battingAverage(a);
      const bb = battingAverage(b);

      if (bb !== ba) return bb - ba;

      if (b.stats.hits !== a.stats.hits) return b.stats.hits - a.stats.hits;
      if (b.stats.rbi !== a.stats.rbi) return b.stats.rbi - a.stats.rbi;
      return a.name.localeCompare(b.name);
    });

    return arr;
  }, [players, anyStatsExist]);

  const leaders = React.useMemo(() => computeLeaders(list), [list]);

  const preSeason = isPreseason();

  return (
    <div className="rosterPage grid gap-5">
      <div className="rosterHeroWrapper">
        <div className="rosterHero">
          <div className="rosterHeroInner">
            <div className="rosterHeroGrid2">
              <div className="rosterHeroLeft2">
                {preSeason ? (
                  <OpeningDayCountdown
                    dateISO="2026-03-28"
                    label="Opening Day"
                  />
                ) : (
                  <div className="recordPillBig">
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      Record
                    </div>
                    <div className="recordValue">
                      {meta.record.wins}-{meta.record.losses}
                      {typeof meta.record.ties === "number"
                        ? `-${meta.record.ties}`
                        : ""}
                    </div>
                  </div>
                )}
              </div>

              <div className="rosterHeroRight2" aria-hidden="true">
                <div className="tigersLogoGrid" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Roster</CardTitle>
          <CardSubtitle>Tap a player for details (next step)</CardSubtitle>
        </CardHeader>

        <CardContent>
          <div className="grid gap-3">
            {list.map((p) => {
              const ba = battingAverage(p);
              const obp = onBasePercentage(p);
              const slg = slugging(p);
              const OPS = ops(p);

              const move = movementForPlayer(p.id);

              return (
                <Link
                  key={p.id}
                  href={`/player?id=${encodeURIComponent(p.id)}`}
                  className="playerRow"
                  aria-label={`Open ${p.name}`}
                >
                  {/* LEFT: player number rail (full height) */}
                  <div className="numberRail" aria-hidden="true">
                    <div className="numberRailGlow" />
                    <div className="numberRailValue">{p.number}</div>
                  </div>

                  {/* RIGHT: content (name + stats) */}
                  <div className="playerBody">
                    <div className="playerTop">
                      <div className="min-w-0">
                        <div className="playerName">{p.name}</div>
                      </div>

                      <div className="playerTopRight">
                        <MovementIcon kind={move} />
                      </div>
                    </div>

                    <div className="mt-4">
                      {/* Mobile */}
                      <div className="sm:hidden grid gap-2">
                        <div className="grid grid-cols-4 gap-2">
                          <Stat
                            label="AVG"
                            value={fmt3(ba)}
                            leader={leaders.avg.includes(p.id)}
                            tone="primary"
                          />
                          <Stat
                            label="OBP"
                            value={fmt3(obp)}
                            leader={leaders.obp.includes(p.id)}
                            tone="accent"
                          />
                          <Stat
                            label="SLG"
                            value={fmt3(slg)}
                            leader={leaders.slg.includes(p.id)}
                            tone="secondary"
                          />
                          <Stat
                            label="OPS"
                            value={fmt3(OPS)}
                            leader={leaders.ops.includes(p.id)}
                            tone="accent2"
                          />
                        </div>
                      </div>

                      {/* Desktop */}
                      <div className="hidden sm:grid grid-cols-8 gap-2">
                        <Stat
                          label="AVG"
                          value={fmt3(ba)}
                          leader={leaders.avg.includes(p.id)}
                          tone="primary"
                        />
                        <Stat
                          label="OBP"
                          value={fmt3(obp)}
                          leader={leaders.obp.includes(p.id)}
                          tone="accent"
                        />
                        <Stat
                          label="SLG"
                          value={fmt3(slg)}
                          leader={leaders.slg.includes(p.id)}
                          tone="secondary"
                        />
                        <Stat
                          label="OPS"
                          value={fmt3(OPS)}
                          leader={leaders.ops.includes(p.id)}
                          tone="accent2"
                        />

                        <Stat
                          label="H"
                          value={String(p.stats.hits)}
                          leader={leaders.hits.includes(p.id)}
                          tone="primary"
                        />
                        <Stat
                          label="AB"
                          value={String(p.stats.atBats)}
                          leader={leaders.atBats.includes(p.id)}
                          tone="secondary"
                        />
                        <Stat
                          label="RBI"
                          value={String(p.stats.rbi)}
                          leader={leaders.rbi.includes(p.id)}
                          tone="accent"
                        />
                        <Stat
                          label="R"
                          value={String(p.stats.runs)}
                          leader={leaders.runs.includes(p.id)}
                          tone="accent2"
                        />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
