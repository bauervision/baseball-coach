"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import type { CareerHistoryRow } from "@/lib/careerHistory";
import { fmt3 } from "@/lib/roster";

/**
 * Compact list of the seasons explicitly linked to this player, oldest
 * first. Shows each season's team, number, and positive recognition only.
 */
export function PlayerCareerHistory(props: {
  rows: CareerHistoryRow[];
  currentSeasonId: string;
}) {
  const { rows, currentSeasonId } = props;
  if (rows.length < 2) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Career History</CardTitle>
        <CardSubtitle>
          {rows.length} seasons · each season&rsquo;s stats stay with that season
        </CardSubtitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2">
          {rows.map((r) => {
            const current = r.seasonId === currentSeasonId;
            return (
              <li
                key={`${r.seasonId}/${r.seasonPlayerId}`}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2"
                style={{
                  borderColor: current
                    ? "color-mix(in oklab, var(--secondary) 60%, transparent)"
                    : "color-mix(in oklab, var(--stroke) 92%, transparent)",
                  background:
                    "color-mix(in oklab, var(--bg-base) 55%, transparent)",
                }}
              >
                <span
                  aria-hidden="true"
                  className="h-8 w-1.5 rounded-full"
                  style={{ background: r.accent ?? "var(--primary)" }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {r.teamName} · {r.seasonLabel}
                    {current ? (
                      <span className="sr-only"> (this season)</span>
                    ) : null}
                  </span>
                  <span
                    className="block truncate text-xs"
                    style={{ color: "var(--muted)" }}
                  >
                    {r.number > 0 ? `#${r.number} · ` : ""}
                    {r.games} game{r.games === 1 ? "" : "s"}
                    {r.atBats > 0 ? ` · ${fmt3(r.hits / r.atBats)} AVG` : ""}
                  </span>
                </span>
                <span className="flex max-w-[55%] flex-wrap justify-end gap-1">
                  {r.recognition.map((label) => (
                    <span
                      key={label}
                      className="whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--secondary) 55%, transparent)",
                      }}
                    >
                      {label}
                    </span>
                  ))}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
