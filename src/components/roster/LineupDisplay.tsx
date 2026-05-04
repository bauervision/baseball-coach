"use client";

import * as React from "react";

import { getFirestoreDb } from "@/lib/firebase.client";
import {
  benchCount,
  playerNameById,
  sortLineupRows,
  type SavedLineup,
} from "@/lib/lineup";
import { loadCurrentLineup } from "@/lib/lineupStore";
import type { Player } from "@/lib/roster";

import {
  Card,
  CardContent,
  CardHeader,
  CardSubtitle,
  CardTitle,
} from "@/components/ui/Card";

type LineupDisplayProps = {
  seasonId: string;
  players: Player[] | null;
};

function positionLabel(value: string | undefined): string {
  return value && value.trim() ? value : "—";
}

export function LineupDisplay({ seasonId, players }: LineupDisplayProps) {
  const [lineup, setLineup] = React.useState<SavedLineup | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setError("");

      try {
        const db = getFirestoreDb();
        const nextLineup = await loadCurrentLineup(db, seasonId);

        if (!alive) return;
        setLineup(nextLineup);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Failed to load lineup.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();

    return () => {
      alive = false;
    };
  }, [seasonId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Batting Lineup</CardTitle>
          <CardSubtitle>Loading lineup…</CardSubtitle>
        </CardHeader>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Batting Lineup</CardTitle>
          <CardSubtitle>Could not load lineup.</CardSubtitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!lineup || lineup.rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Batting Lineup</CardTitle>
          <CardSubtitle>No lineup has been posted yet.</CardSubtitle>
        </CardHeader>
      </Card>
    );
  }

  const inningKeys = Array.from({ length: lineup.inningCount }, (_, i) =>
    String(i + 1),
  );

  const rows = sortLineupRows(
    lineup.rows.filter(
      (row) => !(row as { hiddenFromLineup?: boolean }).hiddenFromLineup,
    ),
  );
  const playerList = players ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Batting Lineup</CardTitle>
        <CardSubtitle>
          Batting order and field assignments by inning.
        </CardSubtitle>
      </CardHeader>

      <CardContent className="min-w-0 overflow-hidden">
        <div className="grid gap-3 sm:hidden">
          {rows.map((row, index) => (
            <div
              key={row.playerId}
              className="min-w-0 overflow-hidden rounded-2xl border p-3"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--stroke) 82%, transparent)",
                background:
                  "color-mix(in oklab, var(--bg-base) 62%, transparent)",
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-extrabold"
                  style={{
                    background:
                      "color-mix(in oklab, var(--primary) 14%, var(--card))",
                    color: "var(--foreground)",
                  }}
                >
                  {index + 1}
                </div>

                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold">
                    {playerNameById(playerList, row.playerId)}
                  </div>
                  <div
                    className="mt-0.5 text-xs"
                    style={{ color: "var(--muted)" }}
                  >
                    Bench count: {benchCount(row)}
                  </div>
                </div>
              </div>

              <div className="mt-3 w-full min-w-0 overflow-x-auto overscroll-x-contain pb-2">
                <div className="flex min-w-max gap-2 pr-3">
                  {inningKeys.map((inning) => {
                    const position = positionLabel(row.innings[inning]);
                    const isBench = position === "BENCH";
                    const isBlank = position === "—";

                    return (
                      <div
                        key={inning}
                        className="w-22 shrink-0 rounded-xl border px-3 py-2 text-center"
                        style={{
                          borderColor:
                            "color-mix(in oklab, var(--stroke) 82%, transparent)",
                          background: isBlank
                            ? "color-mix(in oklab, var(--bg-base) 72%, transparent)"
                            : isBench
                              ? "color-mix(in oklab, var(--stroke) 18%, var(--bg-base))"
                              : "color-mix(in oklab, var(--secondary) 13%, var(--bg-base))",
                        }}
                      >
                        <div
                          className="text-[10px] font-semibold uppercase tracking-wide"
                          style={{ color: "var(--muted)" }}
                        >
                          Inning {inning}
                        </div>
                        <div
                          className="mt-1 text-sm font-extrabold"
                          style={{
                            color: isBlank
                              ? "var(--muted)"
                              : "var(--foreground)",
                          }}
                        >
                          {position}
                        </div>
                      </div>
                    );
                  })}

                  <div
                    className="w-22 shrink-0 rounded-xl border px-3 py-2 text-center"
                    style={{
                      borderColor:
                        "color-mix(in oklab, var(--secondary) 42%, transparent)",
                      background:
                        "color-mix(in oklab, var(--secondary) 10%, var(--bg-base))",
                    }}
                  >
                    <div
                      className="text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: "var(--muted)" }}
                    >
                      Bench
                    </div>
                    <div
                      className="mt-1 text-sm font-extrabold"
                      style={{ color: "var(--secondary)" }}
                    >
                      {benchCount(row)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="hidden min-w-0 max-w-full overflow-hidden sm:block">
          <div className="max-w-full overflow-x-auto pb-2">
            <table className="w-full min-w-175 border-separate border-spacing-y-2 text-sm">
              <thead>
                <tr>
                  <th
                    className="px-2 py-1 text-left text-xs uppercase tracking-wide"
                    style={{ color: "var(--muted)" }}
                  >
                    #
                  </th>
                  <th
                    className="px-2 py-1 text-left text-xs uppercase tracking-wide"
                    style={{ color: "var(--muted)" }}
                  >
                    Player
                  </th>
                  {inningKeys.map((inning) => (
                    <th
                      key={inning}
                      className="px-2 py-1 text-center text-xs uppercase tracking-wide"
                      style={{ color: "var(--muted)" }}
                    >
                      {inning}
                    </th>
                  ))}
                  <th
                    className="px-2 py-1 text-center text-xs uppercase tracking-wide"
                    style={{ color: "var(--muted)" }}
                  >
                    Bench
                  </th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.playerId}>
                    <td
                      className="rounded-l-2xl border-y border-l px-3 py-2 font-bold"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 82%, transparent)",
                        background:
                          "color-mix(in oklab, var(--bg-base) 62%, transparent)",
                      }}
                    >
                      {index + 1}
                    </td>

                    <td
                      className="border-y px-3 py-2 font-semibold"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 82%, transparent)",
                        background:
                          "color-mix(in oklab, var(--bg-base) 62%, transparent)",
                      }}
                    >
                      {playerNameById(playerList, row.playerId)}
                    </td>

                    {inningKeys.map((inning) => {
                      const position = positionLabel(row.innings[inning]);
                      const isBench = position === "BENCH";
                      const isBlank = position === "—";

                      return (
                        <td
                          key={inning}
                          className="border-y px-2 py-2 text-center text-xs font-extrabold"
                          style={{
                            borderColor:
                              "color-mix(in oklab, var(--stroke) 82%, transparent)",
                            background: isBlank
                              ? "color-mix(in oklab, var(--bg-base) 72%, transparent)"
                              : isBench
                                ? "color-mix(in oklab, var(--stroke) 18%, var(--bg-base))"
                                : "color-mix(in oklab, var(--secondary) 12%, var(--bg-base))",
                            color:
                              isBlank || isBench
                                ? "var(--muted)"
                                : "var(--foreground)",
                          }}
                        >
                          {position}
                        </td>
                      );
                    })}

                    <td
                      className="rounded-r-2xl border-y border-r px-3 py-2 text-center font-bold"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 82%, transparent)",
                        background:
                          "color-mix(in oklab, var(--bg-base) 62%, transparent)",
                        color: "var(--secondary)",
                      }}
                    >
                      {benchCount(row)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
