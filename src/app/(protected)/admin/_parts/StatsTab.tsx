// app/admin/_parts/StatsTab.tsx
"use client";

import * as React from "react";
import type { Player } from "@/lib/roster";

import { Card, CardContent, CardHeader, CardTitle, CardSubtitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

import { Field, MiniNumber, Select } from "../adminUiHelpers";
import { toastStyle, type GameResult, anyNonZero, type LineState, type LineDelta } from "../adminHelpers";

export function StatsTab(props: {
  canEdit: boolean;
  rosterError: string | null;
  players: Player[] | null;
  lines: Record<string, LineState>;
  playedCount: number;
  hiddenCount: number;

  date: string;
  setDateAction: (v: string) => void;
  opponent: string;
  setOpponentAction: (v: string) => void;
  result: GameResult;
  setResultAction: (v: GameResult) => void;
  scoreUs: string;
  setScoreUsAction: (v: string) => void;
  scoreThem: string;
  setScoreThemAction: (v: string) => void;

  setDeltaValueAction: (playerId: string, key: keyof LineDelta, value: number) => void;
  toggleHiddenAction: (playerId: string) => void;
  unhideAllAction: () => void;
  resetAllAction: () => void;

  saving: boolean;
  saveError: string | null;
  savedMsg: string | null;
  onSaveGameAction: () => void;
}) {
  const {
    canEdit,
    rosterError,
    players,
    lines,
    playedCount,
    hiddenCount,
    date,
    setDateAction,
    opponent,
    setOpponentAction,
    result,
    setResultAction,
    scoreUs,
    setScoreUsAction,
    scoreThem,
    setScoreThemAction,
    setDeltaValueAction,
    toggleHiddenAction,
    unhideAllAction,
    resetAllAction,
    saving,
    saveError,
    savedMsg,
    onSaveGameAction,
  } = props;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stat Update</CardTitle>
        <CardSubtitle>Enter a game and update season totals for the current season.</CardSubtitle>
      </CardHeader>

      <CardContent className="grid gap-4">
        {rosterError ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {rosterError}
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date" value={date} onChangeAction={setDateAction} type="date" />
          <Field label="Opponent" value={opponent} onChangeAction={setOpponentAction} />

          <Select
            label="Result"
            value={result}
            onChangeAction={(v) => setResultAction(v as GameResult)}
            options={[
              ["W", "Win"],
              ["L", "Loss"],
              ["T", "Tie"],
            ]}
          />

          <div className="grid grid-cols-2 gap-2">
            <Field label="Us" value={scoreUs} onChangeAction={setScoreUsAction} inputMode="numeric" />
            <Field label="Them" value={scoreThem} onChangeAction={setScoreThemAction} inputMode="numeric" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Entered stats for{" "}
            <span style={{ color: "var(--foreground)" }}>{playedCount}</span> player(s).
            {hiddenCount > 0 ? (
              <>
                {" "}
                Hidden: <span style={{ color: "var(--foreground)" }}>{hiddenCount}</span>.
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={unhideAllAction}>
              Show hidden
            </Button>
            <Button variant="ghost" onClick={resetAllAction}>
              Reset stats
            </Button>
          </div>
        </div>

        {saveError ? (
          <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("err")}>
            {saveError}
          </div>
        ) : null}

        {savedMsg ? (
          <div className="rounded-xl border px-3 py-2 text-xs" style={toastStyle("ok")}>
            {savedMsg}
          </div>
        ) : null}

        <div className="grid gap-3">
          {players === null ? (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              Loading players…
            </div>
          ) : (players ?? []).length === 0 ? (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              No players in roster. Use Season Update to rebuild roster.
            </div>
          ) : (
            (players ?? [])
              .slice()
              .sort((a, b) => {
                const na = Number(a.number ?? 0);
                const nb = Number(b.number ?? 0);
                if (na !== nb) return na - nb;
                return String(a.name).localeCompare(String(b.name));
              })
              .map((p) => {
                const row = lines[p.id];
                if (!row) return null;

                if (row.hidden) {
                  return (
                    <div
                      key={p.id}
                      className="rounded-2xl border px-4 py-3"
                      style={{
                        borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
                        background: "color-mix(in oklab, var(--bg-base) 65%, transparent)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {p.name}{" "}
                            <span style={{ color: "var(--muted)" }}>#{p.number}</span>
                          </div>
                          <div className="text-xs" style={{ color: "var(--muted)" }}>
                            Hidden row
                          </div>
                        </div>

                        <Button variant="secondary" onClick={() => toggleHiddenAction(p.id)}>
                          Show
                        </Button>
                      </div>
                    </div>
                  );
                }

                const hasDelta = anyNonZero(row.delta);

                return (
                  <div
                    key={p.id}
                    className="rounded-2xl border p-4"
                    style={{
                      borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
                      background:
                        "linear-gradient(180deg, color-mix(in oklab, var(--card) 92%, var(--bg-base) 8%), var(--card))",
                      boxShadow:
                        "0 0 0 1px color-mix(in oklab, var(--primary) 8%, transparent) inset",
                      opacity: hasDelta ? 1 : 0.98,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {p.name}{" "}
                          <span className="text-xs" style={{ color: "var(--muted)" }}>
                            #{p.number}
                          </span>
                        </div>
                        {p.primaryPos ? (
                          <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                            {p.primaryPos}
                          </div>
                        ) : null}
                      </div>

                      <Button variant="ghost" onClick={() => toggleHiddenAction(p.id)}>
                        Hide
                      </Button>
                    </div>

                    <div className="mt-3 adminStatGrid">
                      <MiniNumber label="AB" value={String(row.delta.atBats)} onChangeAction={(v) => setDeltaValueAction(p.id, "atBats", v)} />
                      <MiniNumber label="H" value={String(row.delta.hits)} onChangeAction={(v) => setDeltaValueAction(p.id, "hits", v)} />
                      <MiniNumber label="2B" value={String(row.delta.doubles)} onChangeAction={(v) => setDeltaValueAction(p.id, "doubles", v)} />
                      <MiniNumber label="3B" value={String(row.delta.triples)} onChangeAction={(v) => setDeltaValueAction(p.id, "triples", v)} />
                      <MiniNumber label="HR" value={String(row.delta.homeRuns)} onChangeAction={(v) => setDeltaValueAction(p.id, "homeRuns", v)} />
                      <MiniNumber label="R" value={String(row.delta.runs)} onChangeAction={(v) => setDeltaValueAction(p.id, "runs", v)} />
                      <MiniNumber label="RBI" value={String(row.delta.rbi)} onChangeAction={(v) => setDeltaValueAction(p.id, "rbi", v)} />
                      <MiniNumber label="BB" value={String(row.delta.walks)} onChangeAction={(v) => setDeltaValueAction(p.id, "walks", v)} />
                      <MiniNumber label="HBP" value={String(row.delta.hitByPitch)} onChangeAction={(v) => setDeltaValueAction(p.id, "hitByPitch", v)} />
                    </div>
                  </div>
                );
              })
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button onClick={onSaveGameAction} disabled={!canEdit || saving}>
            {saving ? "Saving…" : "Save game"}
          </Button>
        </div>

        {!canEdit ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            Sign in and ensure your uid is allowlisted in <code>admins/&lt;uid&gt;</code> to save.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}