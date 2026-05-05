"use client";

import * as React from "react";
import type { Firestore } from "firebase/firestore";

import {
  CURRENT_LINEUP_ID,
  loadCurrentLineup,
  saveCurrentLineup,
} from "@/lib/lineupStore";
import {
  LINEUP_POSITIONS,
  benchCount,
  createEmptyLineupRows,
  playerNameById,
  sortLineupRows,
  validateLineup,
  type LineupPlayerRow,
  type LineupPosition,
  type SavedLineup,
} from "@/lib/lineup";
import {
  battingAverage,
  fmt3,
  onBasePercentage,
  ops,
  slugging,
  type Player,
} from "@/lib/roster";

import {
  Card,
  CardContent,
  CardHeader,
  CardSubtitle,
  CardTitle,
} from "@/components/ui/Card";
import { exportLineupPdf } from "@/lib/exportLineupPdf";

type LineupBuilderTabProps = {
  db: Firestore;
  seasonId: string;
  players: Player[] | null;
  canEdit: boolean;
  teamName: string;
  seasonLabel: string;
};

type LineupPlayerRowWithVisibility = LineupPlayerRow & {
  hiddenFromLineup?: boolean;
};

type SavedLineupWithVisibility = Omit<SavedLineup, "rows"> & {
  rows: LineupPlayerRowWithVisibility[];
};

type DropPlacement = "before" | "after";

type DropTarget = {
  playerId: string;
  placement: DropPlacement;
};

function isHiddenFromLineup(row: LineupPlayerRow): boolean {
  return Boolean((row as LineupPlayerRowWithVisibility).hiddenFromLineup);
}

function visibleLineupRows(rows: LineupPlayerRow[]): LineupPlayerRow[] {
  return sortLineupRows(rows).filter((row) => !isHiddenFromLineup(row));
}

function hiddenLineupRows(rows: LineupPlayerRow[]): LineupPlayerRow[] {
  return sortLineupRows(rows).filter((row) => isHiddenFromLineup(row));
}

function lineupForVisibleRows(
  lineup: SavedLineup,
  rows: LineupPlayerRow[],
): SavedLineup {
  return {
    ...lineup,
    rows: visibleLineupRows(rows).map((row, index) => ({
      ...row,
      battingOrder: index + 1,
    })),
  };
}

function playerById(players: Player[], playerId: string): Player | undefined {
  return players.find((player) => player.id === playerId);
}

function formatAvg(player?: Player): string {
  if (!player) return ".000";
  return fmt3(battingAverage(player));
}

function PlayerStatsHoverCard({
  player,
  openUp = false,
}: {
  player?: Player;
  openUp?: boolean;
}) {
  if (!player) return null;

  const s = player.stats;

  const stats = [
    ["AVG", fmt3(battingAverage(player))],
    ["OBP", fmt3(onBasePercentage(player))],
    ["SLG", fmt3(slugging(player))],
    ["OPS", fmt3(ops(player))],
    ["AB", String(s.atBats)],
    ["H", String(s.hits)],
    ["2B", String(s.doubles)],
    ["3B", String(s.triples)],
    ["HR", String(s.homeRuns)],
    ["RBI", String(s.rbi)],
    ["R", String(s.runs)],
    ["BB", String(s.walks)],
    ["HBP", String(s.hitByPitch)],
    ["SB", String(s.stolenBases)],
    ["PO", String(s.putOuts)],
    ["A", String(s.assists)],
    ["K", String(s.pitchingStrikeouts)],
  ];

  return (
    <div
      className={[
        "pointer-events-none absolute left-0 z-30 hidden w-72 rounded-2xl border p-3 text-xs shadow-2xl group-hover:block group-focus-within:block",
        openUp ? "bottom-full mb-2" : "top-full mt-2",
      ].join(" ")}
      style={{
        borderColor: "color-mix(in oklab, var(--primary) 78%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--card) 96%, #000 4%), color-mix(in oklab, var(--bg-base) 92%, #000 8%))",
        color: "var(--foreground)",
        boxShadow:
          "0 24px 70px rgba(0, 0, 0, 0.72), 0 0 0 1px color-mix(in oklab, var(--primary) 28%, transparent), 0 0 28px color-mix(in oklab, var(--primary) 18%, transparent)",
      }}
    >
      <div className="mb-2">
        <div className="text-sm font-extrabold">{player.name}</div>
        <div style={{ color: "var(--muted)" }}>
          #{player.number}
          {player.primaryPos ? ` · ${player.primaryPos}` : ""}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {stats.map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border px-2 py-1"
            style={{
              borderColor:
                "color-mix(in oklab, var(--stroke) 70%, transparent)",
              background:
                "color-mix(in oklab, var(--bg-base) 58%, transparent)",
            }}
          >
            <div
              className="text-[10px] font-bold uppercase tracking-wide"
              style={{ color: "var(--muted)" }}
            >
              {label}
            </div>
            <div className="font-extrabold">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function availablePositionsForCell(args: {
  rows: LineupPlayerRow[];
  playerId: string;
  inning: string;
}): LineupPosition[] {
  const currentRow = args.rows.find((row) => row.playerId === args.playerId);
  const currentPosition = currentRow?.innings[args.inning] ?? "BENCH";

  const usedPositions = new Set<LineupPosition>();

  for (const row of args.rows) {
    if (row.playerId === args.playerId) continue;

    const position = row.innings[args.inning];
    if (!position || position === "BENCH") continue;

    usedPositions.add(position);
  }

  return LINEUP_POSITIONS.filter((position) => {
    if (position === "") return true;
    if (position === currentPosition) return true;
    return !usedPositions.has(position);
  });
}

function buildDraft(args: {
  seasonId: string;
  players: Player[];
  existing?: SavedLineup | null;
}): SavedLineup {
  const now = new Date().toISOString();

  if (args.existing) {
    const activePlayerIds = new Set(args.players.map((p) => p.id));

    const existingRowsById = new Map(
      args.existing.rows.map((row) => [row.playerId, row]),
    );

    const rows = args.players
      .map((player, index) => {
        const existingRow = existingRowsById.get(player.id);

        if (existingRow) {
          return existingRow as LineupPlayerRowWithVisibility;
        }

        return {
          playerId: player.id,
          battingOrder: index + 1,
          hiddenFromLineup: false,
          innings: Object.fromEntries(
            Array.from({ length: args.existing?.inningCount ?? 6 }, (_, i) => [
              String(i + 1),
              "",
            ]),
          ) as Record<string, LineupPosition>,
        };
      })
      .filter((row) => activePlayerIds.has(row.playerId));

    return {
      ...args.existing,
      seasonId: args.seasonId,
      rows: sortLineupRows(rows).map((row, index) => ({
        ...row,
        battingOrder: index + 1,
      })),
      updatedAtISO: now,
    } as SavedLineupWithVisibility;
  }

  return {
    id: CURRENT_LINEUP_ID,
    title: "Current Lineup",
    seasonId: args.seasonId,
    createdAtISO: now,
    updatedAtISO: now,
    inningCount: 6,
    rows: createEmptyLineupRows(args.players, 6).map((row) => ({
      ...row,
      hiddenFromLineup: false,
    })),
  } as SavedLineupWithVisibility;
}

function reorderRows(
  rows: LineupPlayerRow[],
  draggedPlayerId: string,
  targetPlayerId: string,
  placement: DropPlacement,
): LineupPlayerRow[] {
  if (draggedPlayerId === targetPlayerId) return rows;

  const visibleRows = visibleLineupRows(rows);
  const hiddenRows = hiddenLineupRows(rows);

  const fromIndex = visibleRows.findIndex(
    (row) => row.playerId === draggedPlayerId,
  );

  if (fromIndex < 0) return rows;

  const [removed] = visibleRows.splice(fromIndex, 1);
  if (!removed) return rows;

  const adjustedTargetIndex = visibleRows.findIndex(
    (row) => row.playerId === targetPlayerId,
  );

  if (adjustedTargetIndex < 0) return rows;

  const insertIndex =
    placement === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1;

  visibleRows.splice(insertIndex, 0, removed);

  return [...visibleRows, ...hiddenRows].map((row, index) => ({
    ...row,
    battingOrder: index + 1,
  }));
}

export function LineupBuilderTab({
  db,
  seasonId,
  players,
  canEdit,
  teamName,
  seasonLabel,
}: LineupBuilderTabProps) {
  const [draft, setDraft] = React.useState<SavedLineup | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [draggingPlayerId, setDraggingPlayerId] = React.useState<string | null>(
    null,
  );
  const [dropTarget, setDropTarget] = React.useState<DropTarget | null>(null);
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");

  const activePlayers = React.useMemo(() => players ?? [], [players]);

  React.useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setErr("");
      setMsg("");

      try {
        const existing = await loadCurrentLineup(db, seasonId);

        if (!alive) return;

        setDraft(
          buildDraft({
            seasonId,
            players: activePlayers,
            existing,
          }),
        );
      } catch (error) {
        if (!alive) return;
        setErr(
          error instanceof Error ? error.message : "Failed to load lineup.",
        );
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();

    return () => {
      alive = false;
    };
  }, [db, seasonId, activePlayers]);

  const visibleRows = React.useMemo(
    () => visibleLineupRows(draft?.rows ?? []),
    [draft],
  );

  const hiddenRows = React.useMemo(
    () => hiddenLineupRows(draft?.rows ?? []),
    [draft],
  );

  const issues = React.useMemo(
    () => validateLineup(visibleRows),
    [visibleRows],
  );

  const issueKeys = React.useMemo(() => {
    const keys = new Set<string>();

    for (const issue of issues) {
      for (const playerId of issue.playerIds) {
        keys.add(`${playerId}:${issue.inning}`);
      }
    }

    return keys;
  }, [issues]);

  const inningKeys = React.useMemo(() => {
    const count = draft?.inningCount ?? 6;
    return Array.from({ length: count }, (_, i) => String(i + 1));
  }, [draft]);

  const updatePosition = React.useCallback(
    (playerId: string, inning: string, position: LineupPosition) => {
      setDraft((current) => {
        if (!current) return current;

        return {
          ...current,
          rows: current.rows.map((row) =>
            row.playerId === playerId
              ? {
                  ...row,
                  innings: {
                    ...row.innings,
                    [inning]: position,
                  },
                }
              : row,
          ),
          updatedAtISO: new Date().toISOString(),
        };
      });
    },
    [],
  );

  const toggleHiddenFromLineup = React.useCallback((playerId: string) => {
    setDraft((current) => {
      if (!current) return current;

      return {
        ...current,
        rows: current.rows.map((row) =>
          row.playerId === playerId
            ? {
                ...row,
                hiddenFromLineup: !isHiddenFromLineup(row),
              }
            : row,
        ),
        updatedAtISO: new Date().toISOString(),
      } as SavedLineupWithVisibility;
    });

    setMsg("");
    setErr("");
    setDraggingPlayerId(null);
    setDropTarget(null);
  }, []);

  const reorderPlayer = React.useCallback(
    (targetPlayerId: string, placement: DropPlacement) => {
      if (!draggingPlayerId || !canEdit) return;

      setDraft((current) => {
        if (!current) return current;

        return {
          ...current,
          rows: reorderRows(
            current.rows,
            draggingPlayerId,
            targetPlayerId,
            placement,
          ),
          updatedAtISO: new Date().toISOString(),
        };
      });
    },
    [draggingPlayerId, canEdit],
  );

  const resetDraft = React.useCallback(() => {
    setDraft(
      buildDraft({
        seasonId,
        players: activePlayers,
        existing: null,
      }),
    );
    setMsg("");
    setErr("");
    setDraggingPlayerId(null);
    setDropTarget(null);
  }, [seasonId, activePlayers]);

  const saveDraft = React.useCallback(async () => {
    if (!draft || !canEdit) return;

    setSaving(true);
    setMsg("");
    setErr("");

    try {
      await saveCurrentLineup(db, draft);
      setMsg("Lineup saved.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed to save lineup.");
    } finally {
      setSaving(false);
    }
  }, [db, draft, canEdit]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Lineup Builder</CardTitle>
          <CardSubtitle>Loading lineup…</CardSubtitle>
        </CardHeader>
      </Card>
    );
  }

  if (!draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Lineup Builder</CardTitle>
          <CardSubtitle>Unable to load lineup.</CardSubtitle>
        </CardHeader>

        {err ? (
          <CardContent>
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              {err}
            </div>
          </CardContent>
        ) : null}
      </Card>
    );
  }

  const printableLineup = lineupForVisibleRows(draft, draft.rows);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lineup Builder</CardTitle>
        <CardSubtitle>
          Build the batting order and assign fielding positions by inning.
        </CardSubtitle>
      </CardHeader>

      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <div className="text-sm font-semibold">Current Lineup</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              Drag a player over the top or bottom half of another row to place
              the insertion line. BENCH is allowed for multiple players. Hover a
              player name to review current stats.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetDraft}
              disabled={!canEdit || saving}
              className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--stroke) 92%, transparent)",
                color: "var(--foreground)",
              }}
            >
              Reset
            </button>

            <button
              type="button"
              onClick={saveDraft}
              disabled={!canEdit || saving}
              className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--stroke) 92%, transparent)",
                background:
                  "linear-gradient(90deg, var(--primary), var(--secondary))",
                color: "rgba(0,0,0,0.92)",
              }}
            >
              {saving ? "Saving…" : "Save Lineup"}
            </button>

            <button
              type="button"
              onClick={() => {
                exportLineupPdf({
                  teamName,
                  seasonLabel,
                  lineup: printableLineup,
                  players: activePlayers,
                });
              }}
              disabled={!draft}
              className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--stroke) 92%, transparent)",
                color: "var(--foreground)",
              }}
            >
              Print PDF + Stats
            </button>

            <button
              type="button"
              onClick={() => {
                exportLineupPdf({
                  teamName,
                  seasonLabel,
                  lineup: printableLineup,
                  players: activePlayers,
                  includeStats: false,
                });
              }}
              disabled={!draft}
              className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--stroke) 92%, transparent)",
                color: "var(--foreground)",
              }}
            >
              Print Lineup Only
            </button>
          </div>
        </div>

        {canEdit ? null : (
          <div
            className="rounded-xl border px-3 py-2 text-xs"
            style={{
              borderColor:
                "color-mix(in oklab, var(--stroke) 88%, transparent)",
              background:
                "color-mix(in oklab, var(--bg-base) 65%, transparent)",
              color: "var(--muted)",
            }}
          >
            Sign in as an allowlisted admin to edit the lineup.
          </div>
        )}

        {issues.length > 0 ? (
          <div
            className="rounded-xl border px-3 py-2 text-xs"
            style={{
              borderColor:
                "color-mix(in oklab, var(--accent-2) 60%, transparent)",
              background:
                "color-mix(in oklab, var(--accent-2) 12%, var(--card))",
              color: "var(--foreground)",
            }}
          >
            {issues.length} duplicate assignment
            {issues.length === 1 ? "" : "s"} found. Check highlighted cells.
          </div>
        ) : null}

        {msg ? (
          <div
            className="text-xs font-semibold"
            style={{ color: "var(--secondary)" }}
          >
            {msg}
          </div>
        ) : null}

        {err ? (
          <div
            className="text-xs font-semibold"
            style={{ color: "var(--accent-2)" }}
          >
            {err}
          </div>
        ) : null}

        <div className="-mx-2 overflow-x-auto px-2 pb-2">
          <table className="w-full min-w-240 border-separate border-spacing-y-2 text-sm">
            <thead>
              <tr>
                <th
                  className="px-2 py-1 text-left text-xs uppercase tracking-wide"
                  style={{ color: "var(--muted)" }}
                >
                  Order
                </th>
                <th
                  className="px-2 py-1 text-left text-xs uppercase tracking-wide"
                  style={{ color: "var(--muted)" }}
                >
                  Player
                </th>
                <th
                  className="px-2 py-1 text-center text-xs uppercase tracking-wide"
                  style={{ color: "var(--muted)" }}
                >
                  AVG
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
                <th
                  className="px-2 py-1 text-center text-xs uppercase tracking-wide"
                  style={{ color: "var(--muted)" }}
                >
                  Show
                </th>
              </tr>
            </thead>

            <tbody>
              {visibleRows.map((row, index) => {
                const player = playerById(activePlayers, row.playerId);
                const openTooltipUp =
                  index >= Math.max(visibleRows.length - 4, 0);
                const name =
                  player?.name ?? playerNameById(activePlayers, row.playerId);
                const isDragging = draggingPlayerId === row.playerId;
                const showBeforeLine =
                  dropTarget?.playerId === row.playerId &&
                  dropTarget.placement === "before";
                const showAfterLine =
                  dropTarget?.playerId === row.playerId &&
                  dropTarget.placement === "after";

                const dropShadow = showBeforeLine
                  ? "inset 0 4px 0 var(--secondary), 0 -8px 18px color-mix(in oklab, var(--secondary) 25%, transparent)"
                  : showAfterLine
                    ? "inset 0 -4px 0 var(--secondary), 0 8px 18px color-mix(in oklab, var(--secondary) 25%, transparent)"
                    : undefined;

                const rowBackground = isDragging
                  ? "color-mix(in oklab, var(--secondary) 16%, var(--bg-base))"
                  : "color-mix(in oklab, var(--bg-base) 62%, transparent)";

                return (
                  <tr
                    key={row.playerId}
                    draggable={canEdit}
                    onDragStart={(event) => {
                      if (!canEdit) return;

                      setDraggingPlayerId(row.playerId);
                      setDropTarget(null);

                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", row.playerId);
                    }}
                    onDragOver={(event) => {
                      if (!canEdit || draggingPlayerId === row.playerId) {
                        return;
                      }

                      event.preventDefault();

                      const rect = event.currentTarget.getBoundingClientRect();
                      const midpoint = rect.top + rect.height / 2;
                      const placement: DropPlacement =
                        event.clientY < midpoint ? "before" : "after";

                      setDropTarget((current) => {
                        if (
                          current?.playerId === row.playerId &&
                          current.placement === placement
                        ) {
                          return current;
                        }

                        return {
                          playerId: row.playerId,
                          placement,
                        };
                      });

                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDragLeave={(event) => {
                      const relatedTarget = event.relatedTarget;

                      if (
                        relatedTarget instanceof Node &&
                        event.currentTarget.contains(relatedTarget)
                      ) {
                        return;
                      }

                      setDropTarget((current) =>
                        current?.playerId === row.playerId ? null : current,
                      );
                    }}
                    onDrop={(event) => {
                      if (!canEdit) return;

                      event.preventDefault();

                      const placement =
                        dropTarget?.playerId === row.playerId
                          ? dropTarget.placement
                          : "before";

                      reorderPlayer(row.playerId, placement);

                      setDraggingPlayerId(null);
                      setDropTarget(null);
                    }}
                    onDragEnd={() => {
                      setDraggingPlayerId(null);
                      setDropTarget(null);
                    }}
                    style={{
                      opacity: isDragging ? 0.38 : 1,
                      cursor: canEdit ? "grab" : "default",
                    }}
                  >
                    <td
                      className="rounded-l-2xl border-y border-l px-2 py-2 align-middle"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 82%, transparent)",
                        background: rowBackground,
                        boxShadow: dropShadow,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-6 text-center font-bold">
                          {index + 1}
                        </div>

                        <div
                          className="rounded-lg border px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide"
                          style={{
                            borderColor:
                              "color-mix(in oklab, var(--stroke) 90%, transparent)",
                            background:
                              draggingPlayerId && !isDragging
                                ? "color-mix(in oklab, var(--secondary) 10%, transparent)"
                                : "transparent",
                            color: "var(--muted)",
                          }}
                        >
                          Drag
                        </div>
                      </div>
                    </td>

                    <td
                      className="border-y px-2 py-2 align-middle font-semibold"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 82%, transparent)",
                        background: rowBackground,
                        boxShadow: dropShadow,
                      }}
                    >
                      <div className="group relative inline-flex">
                        <button
                          type="button"
                          className="rounded-lg px-1 text-left font-semibold outline-none focus-visible:ring-2"
                          style={
                            {
                              color: "var(--foreground)",
                              "--tw-ring-color": "var(--secondary)",
                            } as React.CSSProperties
                          }
                        >
                          {name}
                        </button>
                        <PlayerStatsHoverCard
                          player={player}
                          openUp={openTooltipUp}
                        />
                      </div>
                    </td>

                    <td
                      className="border-y px-2 py-2 text-center align-middle font-extrabold"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 82%, transparent)",
                        background: rowBackground,
                        boxShadow: dropShadow,
                        color: "var(--secondary)",
                      }}
                    >
                      {formatAvg(player)}
                    </td>

                    {inningKeys.map((inning) => {
                      const position = row.innings[inning] ?? "";
                      const issue = issueKeys.has(`${row.playerId}:${inning}`);

                      return (
                        <td
                          key={inning}
                          className="border-y px-1 py-2 align-middle"
                          style={{
                            borderColor:
                              "color-mix(in oklab, var(--stroke) 82%, transparent)",
                            background: issue
                              ? "color-mix(in oklab, var(--accent-2) 18%, var(--card))"
                              : rowBackground,
                            boxShadow: dropShadow,
                          }}
                        >
                          <select
                            value={position}
                            disabled={!canEdit}
                            onChange={(event) =>
                              updatePosition(
                                row.playerId,
                                inning,
                                event.target.value as LineupPosition,
                              )
                            }
                            className="w-full rounded-lg border px-2 py-1 text-xs font-semibold outline-none disabled:opacity-60"
                            style={{
                              borderColor: issue
                                ? "color-mix(in oklab, var(--accent-2) 70%, transparent)"
                                : "color-mix(in oklab, var(--stroke) 88%, transparent)",
                              backgroundColor: "#0f1117",
                              color: "#ffffff",
                            }}
                          >
                            {availablePositionsForCell({
                              rows: visibleRows,
                              playerId: row.playerId,
                              inning,
                            }).map((pos) => (
                              <option
                                key={pos}
                                value={pos}
                                style={{
                                  backgroundColor: "#0f1117",
                                  color: "#ffffff",
                                }}
                              >
                                {pos || ""}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}

                    <td
                      className="border-y px-2 py-2 text-center align-middle font-bold"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 82%, transparent)",
                        background: rowBackground,
                        boxShadow: dropShadow,
                        color: "var(--secondary)",
                      }}
                    >
                      {benchCount(row)}
                    </td>

                    <td
                      className="rounded-r-2xl border-y border-r px-2 py-2 text-center align-middle"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--stroke) 82%, transparent)",
                        background: rowBackground,
                        boxShadow: dropShadow,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleHiddenFromLineup(row.playerId)}
                        disabled={!canEdit || saving}
                        className="rounded-lg border px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide disabled:opacity-50"
                        style={{
                          borderColor:
                            "color-mix(in oklab, var(--accent-2) 70%, transparent)",
                          color: "var(--accent-2)",
                        }}
                      >
                        Hide
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {hiddenRows.length > 0 ? (
            <div
              className="rounded-xl border px-3 py-3 text-xs"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--accent-2) 42%, transparent)",
                background:
                  "color-mix(in oklab, var(--accent-2) 8%, var(--card))",
                color: "var(--foreground)",
              }}
            >
              <div className="mb-2 font-bold">
                Hidden from lineup and roster page
              </div>

              <div className="flex flex-wrap gap-2">
                {hiddenRows.map((row) => (
                  <div
                    key={row.playerId}
                    className="flex items-center gap-2 rounded-xl border px-3 py-2"
                    style={{
                      borderColor:
                        "color-mix(in oklab, var(--stroke) 82%, transparent)",
                      background:
                        "color-mix(in oklab, var(--bg-base) 55%, transparent)",
                    }}
                  >
                    <span className="font-semibold">
                      {playerNameById(activePlayers, row.playerId)}
                    </span>

                    <button
                      type="button"
                      onClick={() => toggleHiddenFromLineup(row.playerId)}
                      disabled={!canEdit || saving}
                      className="rounded-lg border px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide disabled:opacity-50"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--secondary) 70%, transparent)",
                        color: "var(--secondary)",
                      }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
