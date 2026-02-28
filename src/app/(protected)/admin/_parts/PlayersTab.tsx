// app/admin/_parts/PlayersTab.tsx
"use client";

import * as React from "react";
import type { Player } from "@/lib/roster";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardSubtitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

import { Field } from "../adminUiHelpers";
import { toastStyle } from "../adminHelpers";

export function PlayersTab(props: {
  canEdit: boolean;
  players: Player[] | null;

  playerEdits: Record<
    string,
    { name: string; number: string; shirtSize: string; dirty: boolean }
  >;

  setPlayerEditValueAction: (
    playerId: string,
    patch: Partial<{ name: string; number: string; shirtSize: string }>,
  ) => void;
  dirtyPlayersCount: number;
  playerBusy: boolean;
  playerMsg: string | null;
  playerErr: string | null;
  onSavePlayerEditsAction: () => void;
}) {
  const {
    canEdit,
    players,
    playerEdits,
    setPlayerEditValueAction,
    dirtyPlayersCount,
    playerBusy,
    playerMsg,
    playerErr,
    onSavePlayerEditsAction,
  } = props;

  const SHIRT_SIZES = [
    "",
    "YXS",
    "YS",
    "YM",
    "YL",
    "YXL",
    "AS",
    "AM",
    "AL",
    "AXL",
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Player Update</CardTitle>
        <CardSubtitle>
          Edit player name and number for the current season.
        </CardSubtitle>
      </CardHeader>

      <CardContent className="grid gap-4">
        {!canEdit ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Sign in and ensure your uid is allowlisted to edit players.
          </div>
        ) : null}

        {playerErr ? (
          <div
            className="rounded-xl border px-3 py-2 text-xs"
            style={toastStyle("err")}
          >
            {playerErr}
          </div>
        ) : null}

        {playerMsg ? (
          <div
            className="rounded-xl border px-3 py-2 text-xs"
            style={toastStyle("ok")}
          >
            {playerMsg}
          </div>
        ) : null}

        {players === null ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Loading players…
          </div>
        ) : (players ?? []).length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            No players in roster. Use Season Update to rebuild roster.
          </div>
        ) : (
          <div className="grid gap-2">
            {(players ?? [])
              .slice()
              .sort((a, b) => {
                const na = Number(a.number ?? 0);
                const nb = Number(b.number ?? 0);
                if (na !== nb) return na - nb;
                return String(a.name).localeCompare(String(b.name));
              })
              .map((p) => {
                const edit = playerEdits[p.id] ?? {
                  name: p.name,
                  number: String(p.number ?? 0),
                  shirtSize: String(p.shirtSize ?? ""),
                  dirty: false,
                };

                return (
                  <div
                    key={p.id}
                    className="rounded-2xl border p-3"
                    style={{
                      borderColor:
                        "color-mix(in oklab, var(--stroke) 92%, transparent)",
                      background:
                        "linear-gradient(180deg, color-mix(in oklab, var(--card) 92%, var(--bg-base) 8%), var(--card))",
                      boxShadow:
                        "0 0 0 1px color-mix(in oklab, var(--primary) 8%, transparent) inset",
                    }}
                  >
                    <div className="grid gap-2 sm:grid-cols-12 sm:items-end">
                      <div className="sm:col-span-7">
                        <Field
                          label="Name"
                          value={edit.name}
                          onChangeAction={(v) =>
                            setPlayerEditValueAction(p.id, { name: v })
                          }
                          disabled={!canEdit || playerBusy}
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <Field
                          label="Number"
                          value={edit.number}
                          onChangeAction={(v) =>
                            setPlayerEditValueAction(p.id, { number: v })
                          }
                          inputMode="numeric"
                          disabled={!canEdit || playerBusy}
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <div className="grid gap-1">
                          <div
                            className="text-xs"
                            style={{ color: "var(--muted)" }}
                          >
                            Shirt size
                          </div>

                          <select
                            value={edit.shirtSize}
                            onChange={(e) =>
                              setPlayerEditValueAction(p.id, {
                                shirtSize: e.target.value,
                              })
                            }
                            disabled={!canEdit || playerBusy}
                            className="h-10 w-full rounded-xl border px-3 text-sm outline-none"
                            style={{
                              borderColor:
                                "color-mix(in oklab, var(--stroke) 92%, transparent)",
                              background:
                                "color-mix(in oklab, var(--card) 92%, var(--bg-base) 8%)",
                              color: "var(--foreground)",
                            }}
                          >
                            {SHIRT_SIZES.map((s) => (
                              <option
                                key={s}
                                value={s}
                                style={{ color: "#000" }}
                              >
                                {s === "" ? "Select…" : s}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="sm:col-span-2 flex items-center justify-end gap-2">
                        <div
                          className="text-xs"
                          style={{ color: "var(--muted)" }}
                        >
                          {edit.dirty ? "Edited" : "Saved"}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            Pending changes:{" "}
            <span style={{ color: "var(--foreground)", fontWeight: 700 }}>
              {dirtyPlayersCount}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={onSavePlayerEditsAction}
              disabled={!canEdit || playerBusy || dirtyPlayersCount === 0}
            >
              {playerBusy ? "Saving…" : "Save player changes"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
