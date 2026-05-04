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
import { ArrowDown, ArrowUp, Star, Trophy } from "lucide-react";
import { OpeningDayCountdown } from "./OpeningDayCountdown";
import { exportLeaderboardPdf } from "@/lib/exportLeaderBoardPdf";
import { computeTrophies } from "@/lib/trophies";
import { LineupDisplay } from "./LineupDisplay";

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
    stolenBases: number;
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

type RosterStatItem = {
  label: string;
  value: string;
  leader: boolean;
  tone: "primary" | "secondary" | "accent" | "accent2";
};

function rosterStatsForPlayer(args: {
  playerId: string;
  stats: {
    hits: number;
    atBats: number;
    rbi: number;
    runs: number;
    walks: number;
    hitByPitch: number;
    doubles: number;
    triples: number;
    homeRuns: number;
    pitchingStrikeouts: number;
    stolenBases: number;
    putOuts: number;
    assists: number;
  };
  avg: string;
  obp: string;
  slg: string;
  opsValue: string;
  leaders: ReturnType<typeof computeLeaders>;
}): RosterStatItem[] {
  const { playerId, stats, avg, obp, slg, opsValue, leaders } = args;

  return [
    {
      label: "AVG",
      value: avg,
      leader: leaders.avg.includes(playerId),
      tone: "primary",
    },
    {
      label: "OBP",
      value: obp,
      leader: leaders.obp.includes(playerId),
      tone: "accent",
    },
    {
      label: "SLG",
      value: slg,
      leader: leaders.slg.includes(playerId),
      tone: "secondary",
    },
    {
      label: "OPS",
      value: opsValue,
      leader: leaders.ops.includes(playerId),
      tone: "accent2",
    },
    {
      label: "H",
      value: String(stats.hits),
      leader: leaders.hits.includes(playerId),
      tone: "primary",
    },
    {
      label: "AB",
      value: String(stats.atBats),
      leader: leaders.atBats.includes(playerId),
      tone: "secondary",
    },
    {
      label: "RBI",
      value: String(stats.rbi),
      leader: leaders.rbi.includes(playerId),
      tone: "accent",
    },
    {
      label: "R",
      value: String(stats.runs),
      leader: leaders.runs.includes(playerId),
      tone: "accent2",
    },
    {
      label: "BB",
      value: String(stats.walks),
      leader: leaders.walks.includes(playerId),
      tone: "primary",
    },
    {
      label: "HBP",
      value: String(stats.hitByPitch),
      leader: leaders.hitByPitch.includes(playerId),
      tone: "accent",
    },
    {
      label: "2B",
      value: String(stats.doubles),
      leader: leaders.doubles.includes(playerId),
      tone: "secondary",
    },
    {
      label: "3B",
      value: String(stats.triples),
      leader: leaders.triples.includes(playerId),
      tone: "accent2",
    },
    {
      label: "HR",
      value: String(stats.homeRuns),
      leader: leaders.homeRuns.includes(playerId),
      tone: "primary",
    },
    {
      label: "SB",
      value: String(stats.stolenBases),
      leader: leaders.stolenBases.includes(playerId),
      tone: "secondary",
    },
    {
      label: "PO",
      value: String(stats.putOuts),
      leader: leaders.putOuts.includes(playerId),
      tone: "accent",
    },
    {
      label: "A",
      value: String(stats.assists),
      leader: leaders.assists.includes(playerId),
      tone: "accent2",
    },
    {
      label: "P-K",
      value: String(stats.pitchingStrikeouts),
      leader: leaders.pitchingStrikeouts.includes(playerId),
      tone: "primary",
    },
  ];
}

export function Roster() {
  const { seasonId, meta, players, error } = useRosterPlayers();

  const anyStatsExist = React.useMemo(() => {
    const src = players ?? [];
    return src.some((p) => hasAnyRecordedStats(p));
  }, [players]);

  const list = React.useMemo(() => {
    const src = players ?? [];
    const visiblePlayers = src.filter((p) => p.leaderboardHidden !== true);
    const hiddenPlayers = src.filter((p) => p.leaderboardHidden === true);

    function sortVisiblePlayers(
      arr: typeof visiblePlayers,
    ): typeof visiblePlayers {
      const next = [...arr];

      if (!anyStatsExist) {
        next.sort((a, b) => sortByLastNameThenFirst(a.name, b.name));
        return next;
      }

      next.sort((a, b) => {
        const ba = battingAverage(a);
        const bb = battingAverage(b);

        if (bb !== ba) return bb - ba;
        if (b.stats.hits !== a.stats.hits) return b.stats.hits - a.stats.hits;
        if (b.stats.rbi !== a.stats.rbi) return b.stats.rbi - a.stats.rbi;

        return a.name.localeCompare(b.name);
      });

      return next;
    }

    const sortedHiddenPlayers = [...hiddenPlayers].sort((a, b) =>
      sortByLastNameThenFirst(a.name, b.name),
    );

    return [...sortVisiblePlayers(visiblePlayers), ...sortedHiddenPlayers];
  }, [players, anyStatsExist]);

  const leaders = React.useMemo(() => computeLeaders(list), [list]);
  const preSeason = isPreseason();

  return (
    <div className="rosterPage grid min-w-0 max-w-full gap-5 overflow-hidden">
      <div className="min-w-0 max-w-full overflow-hidden">
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
                    <div
                      className="grid max-w-full place-items-center rounded-3xl border px-6 py-6 sm:px-8 sm:py-7"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 88%, transparent)",
                        background:
                          "linear-gradient(180deg, color-mix(in oklab, var(--card) 88%, transparent), color-mix(in oklab, var(--bg-base) 62%, transparent))",
                        boxShadow:
                          "0 0 0 1px color-mix(in oklab, var(--primary) 10%, transparent) inset, 0 16px 36px color-mix(in oklab, var(--stroke) 18%, transparent)",
                        width: "fit-content",
                        minWidth: "clamp(170px, 22vw, 250px)",
                      }}
                    >
                      <div
                        className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] sm:text-xs"
                        style={{ color: "var(--muted)" }}
                      >
                        Record
                      </div>

                      <div
                        className="mt-3 text-center text-5xl font-extrabold leading-none tracking-tight sm:text-6xl lg:text-7xl"
                        style={{ color: "var(--foreground)" }}
                      >
                        {meta.record.wins}-{meta.record.losses}
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
      </div>

      <button
        onClick={() => {
          exportLeaderboardPdf({
            teamName: meta.teamName,
            seasonLabel: meta.seasonLabel,
            record: meta.record,
            players: list,
            leaders,
            awards: computeTrophies(list),
          });
        }}
        className="w-full max-w-full truncate rounded-xl border px-3 py-2 text-sm font-semibold"
        style={{
          borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
          background:
            "linear-gradient(90deg, var(--primary), var(--secondary))",
          color: "rgba(0,0,0,0.92)",
        }}
      >
        Download Leaderboard PDF
      </button>

      <Link
        href="/trophies"
        className="group block min-w-0 max-w-full overflow-hidden rounded-2xl border p-4 transition-opacity hover:opacity-95 sm:p-5"
        style={{
          borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
          background:
            "linear-gradient(90deg, color-mix(in oklab, var(--secondary) 22%, var(--card)), color-mix(in oklab, var(--primary) 16%, var(--card)))",
          boxShadow:
            "0 0 0 1px color-mix(in oklab, var(--secondary) 14%, transparent) inset",
        }}
        aria-label="Open Trophy Case"
      >
        <div className="flex min-w-0 items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-3">
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

              <div className="min-w-0">
                <div
                  className="truncate text-base font-extrabold leading-tight sm:text-lg"
                  style={{ color: "var(--foreground)" }}
                >
                  Trophy Case
                </div>
                <div
                  className="mt-1 truncate text-xs sm:text-sm"
                  style={{ color: "var(--muted)" }}
                >
                  Updates During Season • Tap to learn how awards are calculated
                </div>
              </div>
            </div>
          </div>

          <div className="hidden shrink-0 sm:block">
            <div
              className="rounded-xl border px-3 py-2 text-sm font-semibold transition-opacity group-hover:opacity-95"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--stroke) 92%, transparent)",
                background:
                  "linear-gradient(90deg, var(--primary), var(--secondary))",
                color: "rgba(0,0,0,0.92)",
              }}
            >
              View trophies
            </div>
          </div>
        </div>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Roster</CardTitle>
          <CardSubtitle>Tap a player for details</CardSubtitle>
        </CardHeader>

        <CardContent className="min-w-0 overflow-hidden">
          {error ? (
            <div className="mb-4 text-sm" style={{ color: "var(--muted)" }}>
              {error}
            </div>
          ) : null}

          <div className="grid min-w-0 gap-3">
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
                  className="playerRow min-w-0 max-w-full overflow-hidden"
                  aria-label={`Open ${p.name}`}
                >
                  <div
                    className="numberRail shrink-0"
                    aria-hidden="true"
                    style={{ width: "clamp(72px, 18vw, 92px)" }}
                  >
                    <div className="numberRailGlow" />
                    <div className="numberRailValue">{p.number}</div>
                  </div>

                  <div className="playerBody min-w-0 flex-1 overflow-hidden">
                    <div className="playerTop min-w-0">
                      <div className="min-w-0">
                        <div className="playerName truncate">{p.name}</div>
                      </div>

                      <div className="playerTopRight">
                        <MovementIcon kind={move} />
                      </div>
                    </div>

                    <div className="mt-3 min-w-0 sm:mt-4">
                      {(() => {
                        const statItems = rosterStatsForPlayer({
                          playerId: p.id,
                          stats: p.stats,
                          avg: fmt3(ba),
                          obp: fmt3(obp),
                          slg: fmt3(slg),
                          opsValue: fmt3(OPS),
                          leaders,
                        });

                        return (
                          <>
                            <div className="max-w-full overflow-x-auto pb-2 sm:hidden">
                              <div className="flex w-max max-w-none gap-2">
                                {statItems.map((item) => (
                                  <Stat
                                    key={item.label}
                                    label={item.label}
                                    value={item.value}
                                    leader={item.leader}
                                    tone={item.tone}
                                    compact
                                  />
                                ))}
                              </div>
                            </div>

                            <div className="hidden min-w-0 grid-cols-6 gap-2 sm:grid lg:grid-cols-9 2xl:grid-cols-17">
                              {statItems.map((item) => (
                                <Stat
                                  key={item.label}
                                  label={item.label}
                                  value={item.value}
                                  leader={item.leader}
                                  tone={item.tone}
                                />
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="min-w-0 max-w-full overflow-hidden">
        <LineupDisplay seasonId={seasonId} players={players} />
      </div>
    </div>
  );
}
